// System and per-runner CPU, RAM and GPU usage, sampled from Windows
// performance counters by one long-running PowerShell process.

import { spawn } from 'node:child_process';
import { availableParallelism, freemem, totalmem } from 'node:os';
import { join } from 'node:path';

import { runners, scheduleRender, state, system32 } from './state.mjs';

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
  [Console]::Out.WriteLine('{"cpu":' + $busy + ',"procs":[' + ($procs -join ',') + '],"engines":[' + ($engines -join ',') + ']}')
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
  };
}

// Highest "used" and "runners" seen for each resource since the dashboard started.
function recordPeak(usage) {
  state.peak ??= {};
  for (const resource of ['cpu', 'ram', 'gpu']) {
    const peak = (state.peak[resource] ??= { used: 0, runners: 0 });
    peak.used = Math.max(peak.used, usage[resource].used);
    peak.runners = Math.max(peak.runners, usage[resource].runners);
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
}
