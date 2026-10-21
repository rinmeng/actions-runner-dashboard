// System and per-runner CPU, RAM and GPU usage, sampled from Windows
// performance counters by one long-running PowerShell process, plus disk space,
// network speed and temperatures.

import { execFile, spawn } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { availableParallelism, freemem, totalmem } from 'node:os';
import { join, parse, resolve } from 'node:path';

import { home, runners, scheduleRender, state, system32 } from './state.mjs';

const SAMPLE_SECONDS = 2;

// Prints one JSON line per sample. CPU figures are percent of one thread, like
// the counters themselves. GPU engines are "pid_<pid>_luid_<adapter>_…_engtype_<type>".
const SAMPLER_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  $busy = 0
  $procs = foreach ($p in Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Property Name,IDProcess,CreatingProcessID,PercentProcessorTime,WorkingSetPrivate) {
    if ($p.Name -eq '_Total') { $busy += $p.PercentProcessorTime }
    elseif ($p.Name -eq 'Idle') { $busy -= $p.PercentProcessorTime }
    else { '[{0},{1},{2},{3}]' -f $p.IDProcess, $p.CreatingProcessID, $p.PercentProcessorTime, $p.WorkingSetPrivate }
  }
  $engines = foreach ($e in Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Property Name,UtilizationPercentage) {
    if ($e.UtilizationPercentage -gt 0 -and $e.Name -match '^pid_(\\d+)_luid_(\\w+?_\\w+?)_.*engtype_(.*)$') {
      '[{0},"{1}/{2}",{3}]' -f $Matches[1], $Matches[2], $Matches[3], $e.UtilizationPercentage
    }
  }
  $down = 0; $up = 0
  foreach ($n in Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface -Property BytesReceivedPersec,BytesSentPersec) {
    $down += $n.BytesReceivedPersec; $up += $n.BytesSentPersec
  }
  [Console]::Out.WriteLine('{"cpu":' + $busy + ',"procs":[' + ($procs -join ',') + '],"engines":[' + ($engines -join ',') + '],"net":[' + $down + ',' + $up + ']}')
  [Console]::Out.Flush()
  Start-Sleep -Seconds ${SAMPLE_SECONDS}
}`;

// Every process started by a runner's listener: its worker, and the job's shells, node, python, ….
function runnerProcessIds(procs) {
  const children = new Map();
  for (const [pid, parent] of procs) {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(pid);
  }
  const ids = new Set();
  const queue = runners.flatMap((runner) => (runner.child?.pid ? [runner.child.pid] : []));
  while (queue.length) {
    const pid = queue.pop();
    if (ids.has(pid)) continue;
    ids.add(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return ids;
}

// Like Task Manager: add up each engine's use across processes, then report the busiest engine.
function busiestEngine(engines, include) {
  const totals = new Map();
  for (const [pid, engine, percent] of engines) {
    if (include(pid)) totals.set(engine, (totals.get(engine) ?? 0) + percent);
  }
  return Math.min(100, Math.max(0, ...totals.values()));
}

// Temperatures and network speed come from LibreHardwareMonitor's web server when it is
// running (Ryzen CPUs report no temperature to Windows at all). Without it, the GPU
// temperature falls back to nvidia-smi and network speed to the performance counters.
const SENSORS_URL = 'http://localhost:8085/data.json';
const RATE_UNITS = { 'B/s': 1, 'KB/s': 1024, 'MB/s': 1024 ** 2, 'GB/s': 1024 ** 3 };
let sensors = {};

// "54.3 °C" or "2.9 KB/s" as a number, rates in bytes per second.
function sensorValue(text) {
  const [number, unit] = text.split(' ');
  return parseFloat(number.replace(',', '.')) * (RATE_UNITS[unit] ?? 1);
}

// Every sensor in the tree, with the name of the hardware it belongs to.
function sensorList(node, hardware = '', list = []) {
  if (node.HardwareId) hardware = node.Text;
  if (node.SensorId) list.push({ id: node.SensorId, name: node.Text, hardware, value: sensorValue(node.Value) });
  for (const child of node.Children ?? []) sensorList(child, hardware, list);
  return list;
}

function pickSensors(list) {
  const find = (id, name) => list.find((sensor) => id.test(sensor.id) && name.test(sensor.name))?.value ?? null;
  // WSL's virtual adapter would count its traffic a second time.
  const nics = list.filter((sensor) => sensor.id.startsWith('/nic/') && !sensor.hardware.startsWith('vEthernet'));
  const rate = (name) => nics.filter((sensor) => sensor.name === name).reduce((sum, sensor) => sum + sensor.value, 0);
  // The runners' disk, by the name Windows gave it in readSpecs.
  const disk = (name) =>
    list.find((sensor) => sensor.hardware === state.specs?.disk?.name && sensor.name === name)?.value ?? null;
  return {
    cpuTemp: find(/^\/(amd|intel)cpu\/.*\/temperature\//, /Tctl|Package/),
    gpuTemp: find(/^\/gpu-nvidia\/.*\/temperature\//, /^GPU Core$/),
    gpuHotSpot: find(/^\/gpu-nvidia\/.*\/temperature\//, /Hot Spot/),
    ssdTemp: find(/^\/nvme\/.*\/temperature\//, /Composite/),
    net: nics.length ? { down: rate('Download Speed'), up: rate('Upload Speed') } : null,
    diskRead: disk('Read Rate'),
    diskWrite: disk('Write Rate'),
  };
}

function nvidiaSmiTemp() {
  return new Promise((done) => {
    execFile('nvidia-smi', ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'], { windowsHide: true }, (error, stdout) =>
      done(error ? null : parseFloat(stdout) || null),
    );
  });
}

async function readSensors() {
  try {
    const response = await fetch(SENSORS_URL, { signal: AbortSignal.timeout(1000) });
    sensors = pickSensors(sensorList(await response.json()));
  } catch {
    sensors = { gpuTemp: await nvidiaSmiTemp() };
  }
}

// The drive the runners' work folders are on, as "C:".
const DRIVE = parse(resolve(home)).root.replace(/\\$/, '');

// Free and total space on that drive.
function diskSpace() {
  const { bavail, blocks, bsize } = statfsSync(home);
  return { drive: DRIVE, free: bavail * bsize, total: blocks * bsize };
}

// The machine's hardware, read once: CPU, GPU, RAM and the runners' disk.
const SPECS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$ram = @(Get-CimInstance Win32_PhysicalMemory)
$disk = Get-Partition -DriveLetter '${DRIVE[0]}' | Get-Disk
$gpu = nvidia-smi --query-gpu=name,memory.total,clocks.max.graphics --format=csv,noheader,nounits | Select-Object -First 1
if ($gpu) { $gpu = $gpu -split ',\\s*'; $gpu = @{ name = $gpu[0]; memoryMb = [int]$gpu[1]; maxMhz = [int]$gpu[2] } }
else { $gpu = @{ name = (Get-CimInstance Win32_VideoController | Select-Object -First 1).Name } }
@{
  cpu = @{ name = $cpu.Name.Trim(); cores = $cpu.NumberOfCores; threads = $cpu.NumberOfLogicalProcessors; baseMhz = $cpu.MaxClockSpeed }
  gpu = $gpu
  ram = @{ part = ($ram | Select-Object -First 1).PartNumber.Trim(); maker = ($ram | Select-Object -First 1).Manufacturer; sticks = $ram.Count;
           stickBytes = ($ram | Select-Object -First 1).Capacity; mts = ($ram | Select-Object -First 1).ConfiguredClockSpeed; type = ($ram | Select-Object -First 1).SMBIOSMemoryType }
  disk = @{ name = $disk.FriendlyName; bus = "$($disk.BusType)" }
} | ConvertTo-Json -Compress`;

function readSpecs() {
  const child = spawn(
    join(system32, 'WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SPECS_SCRIPT, 'utf16le').toString('base64')],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (text) => (output += text));
  child.on('close', () => {
    try {
      state.specs = JSON.parse(output);
      scheduleRender();
    } catch {
      // No specs; the dashboard shows the cards without them.
    }
  });
  child.on('error', () => {});
}

function summarize(sample) {
  const threads = availableParallelism();
  const ids = runnerProcessIds(sample.procs);
  let runnerCpu = 0;
  let runnerRam = 0;
  for (const [pid, , cpu, ram] of sample.procs) {
    if (!ids.has(pid)) continue;
    runnerCpu += cpu;
    runnerRam += ram;
  }
  return {
    threads,
    cpu: { used: sample.cpu / threads, runners: runnerCpu / threads },
    ram: { total: totalmem(), used: totalmem() - freemem(), runners: runnerRam },
    gpu: { used: busiestEngine(sample.engines, () => true), runners: busiestEngine(sample.engines, (pid) => ids.has(pid)) },
    // Read and write rates are bytes per second, or null without LibreHardwareMonitor.
    disk: { ...diskSpace(), read: sensors.diskRead ?? null, write: sensors.diskWrite ?? null },
    net: sensors.net ?? { down: sample.net[0], up: sample.net[1] },
    // °C, or null when there is no sensor to read.
    temp: {
      cpu: sensors.cpuTemp ?? null,
      gpu: sensors.gpuTemp ?? null,
      gpuHotSpot: sensors.gpuHotSpot ?? null,
      ssd: sensors.ssdTemp ?? null,
    },
  };
}

// Readings that show their lowest and highest value this session, by "group.name".
const RANGED = ['temp.cpu', 'temp.gpu', 'temp.gpuHotSpot', 'temp.ssd', 'net.down', 'net.up'];

// Highest "used" and "runners" seen for each resource since the dashboard started,
// and the lowest and highest of each RANGED reading.
function recordPeak(usage) {
  state.peak ??= {};
  for (const resource of ['cpu', 'ram', 'gpu']) {
    const peak = (state.peak[resource] ??= { used: 0, runners: 0 });
    peak.used = Math.max(peak.used, usage[resource].used);
    peak.runners = Math.max(peak.runners, usage[resource].runners);
  }
  state.range ??= {};
  for (const key of RANGED) {
    const [group, name] = key.split('.');
    const value = usage[group][name];
    if (value == null) continue;
    const range = (state.range[key] ??= { min: value, max: value });
    range.min = Math.min(range.min, value);
    range.max = Math.max(range.max, value);
  }
}

export function startUsageSampler() {
  const child = spawn(
    join(system32, 'WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SAMPLER_SCRIPT, 'utf16le').toString('base64')],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  let partial = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (text) => {
    const lines = (partial + text).split('\n');
    partial = lines.pop() ?? '';
    const last = lines.findLast((line) => line.trim());
    if (!last) return;
    try {
      state.usage = summarize(JSON.parse(last));
      recordPeak(state.usage);
      scheduleRender();
    } catch {
      // A malformed sample; the next one replaces it.
    }
  });
  child.on('error', () => {});
  process.on('exit', () => child.kill());

  readSensors();
  setInterval(readSensors, SAMPLE_SECONDS * 1000).unref();
  readSpecs();
}
