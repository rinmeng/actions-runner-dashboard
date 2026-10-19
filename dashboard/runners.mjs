// Starting and stopping the runners, and tracking what each one is doing from its output.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  allView,
  MAX_LINES,
  plain,
  runners,
  scheduleRender,
  selectedView,
  state,
  system32,
} from './state.mjs';
import { restoreTerminal } from './terminal.mjs';
import { bold, color, dim, link, red, RESET, sanitize, yellow } from './text.mjs';

// How long a runner gets to end its GitHub session before it is force-killed.
const STOP_TIMEOUT_MS = 30_000;
const RUNNING = /^(.*Z): Running job: (.*)$/;
const COMPLETED = /Job (.*) completed with result: (\w+)/;
const DISCONNECTED = /Runner connect error|session for this runner already exists/;
const WORKER_LOG = /^Worker_.*\.log$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const tag = (runner) => color(runner.color, `[${runner.label}]`);

function append(view, entry) {
  view.lines.push(entry);
  if (view.lines.length > MAX_LINES) {
    const excess = view.lines.length - MAX_LINES;
    view.lines.splice(0, excess);
    view.dropped += excess;
  }
  if (view.scroll > 0) view.scroll = Math.min(view.scroll + 1, view.lines.length - 1);
}

// Entries are shared by the runner's view and the "All runners" view, so a
// line rewritten later (see describeJob) changes in both.
function push(runner, text) {
  const entry = { runner, text };
  if (plain) {
    process.stdout.write(`${tag(runner)} ${text}${RESET}\n`);
    return entry;
  }
  append(runner, entry);
  append(allView, entry);
  if (runner !== selectedView()) runner.unread = true;
  scheduleRender();
  return entry;
}

export const log = (runner, text) => push(runner, text);

function setStatus(runner, status) {
  runner.status = status;
  scheduleRender();
}

function ingest(runner, text) {
  const parts = (runner.partial + text).split('\n');
  runner.partial = parts.pop() ?? '';
  for (const part of parts) onLine(runner, part);
}

function onLine(runner, raw) {
  let text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
  const carriageReturn = text.lastIndexOf('\r');
  if (carriageReturn !== -1) text = text.slice(carriageReturn + 1);
  text = sanitize(text);
  const entry = push(runner, text);

  let match;
  if (text.includes('Listening for Jobs') || /reconnected/i.test(text)) {
    setStatus(runner, 'idle');
  } else if ((match = RUNNING.exec(text))) {
    runner.job = { name: match[2], startedAt: Date.now() };
    setStatus(runner, 'busy');
    void describeJob(runner, runner.job, entry, match[1]);
  } else if ((match = COMPLETED.exec(text))) {
    runner.last = { ...runner.job, name: match[1], result: match[2] };
    runner.job = null;
    setStatus(runner, 'idle');
  } else if (DISCONNECTED.test(text)) {
    setStatus(runner, 'reconnecting');
  }
}

// --- Who asked for the job -------------------------------------------------

function newestWorkerLog(runner) {
  const diag = join(runner.dir, '_diag');
  try {
    // Names are Worker_YYYYMMDD-HHMMSS-utc.log, so the last one sorted is the newest.
    const names = readdirSync(diag).filter((name) => WORKER_LOG.test(name)).sort();
    return names.length ? join(diag, names.at(-1)) : null;
  } catch {
    return null;
  }
}

// The worker log holds the job's github context as "k"/"v" pairs on separate lines.
function parseJobContext(text) {
  const values = {};
  let key = null;
  for (const line of text.split('\n')) {
    const k = /"k": "([^"]+)"/.exec(line);
    if (k) {
      key = k[1];
      continue;
    }
    const v = key && /"v": (.*?),?\s*$/.exec(line);
    if (v) {
      if (!(key in values)) values[key] = v[1].replace(/^"|"$/g, '');
      key = null;
    }
  }
  const event = values.event_name ?? '';
  return {
    actor: values.triggering_actor ?? values.actor ?? 'unknown',
    event,
    pr: event === 'pull_request' ? Number.parseInt(values.number, 10) || null : null,
    workflow: values.workflow ?? '',
  };
}

// The listener prints "Running job" around when the worker starts writing its
// log, so wait up to 10s for a worker log newer than the last job's.
async function waitForJobContext(runner) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const file = newestWorkerLog(runner);
    if (file && file !== runner.workerLog) {
      try {
        const text = readFileSync(file, 'utf8');
        if (text.includes('"triggering_actor"')) {
          runner.workerLog = file;
          return parseJobContext(text);
        }
      } catch {
        // Still being created.
      }
    }
    await sleep(250);
  }
  return null;
}

export const prLink = (runner, job) =>
  job.pr ? link(`${runner.repoUrl}/pull/${job.pr}`, `PR #${job.pr}`) : job.event;

// Rewrites "<time>: Running job: X" into "<time> @user (PR #n) requested: Workflow › X".
async function describeJob(runner, job, entry, timestamp) {
  const context = await waitForJobContext(runner);
  if (!context) return;
  Object.assign(job, context);
  if (runner.last && runner.last.startedAt === job.startedAt) Object.assign(runner.last, context);
  entry.text = `${timestamp} ${bold(`@${job.actor}`)} (${prLink(runner, job)}) requested: ${job.workflow} › ${bold(job.name)}`;
  if (plain) process.stdout.write(`${tag(runner)} ${entry.text}${RESET}\n`);
  scheduleRender();
}

// --- Processes -------------------------------------------------------------

export function start(runner) {
  if (runner.child || state.quitting) return;
  const runId = ++runner.runId;
  if (!runner.workerLog) runner.workerLog = newestWorkerLog(runner);
  setStatus(runner, 'starting');
  log(runner, dim('$ bin\\Runner.Listener.exe run'));

  // run.cmd is not used: on Ctrl+C its batch file asks "Terminate batch job (Y/N)?",
  // and with no answer it carries on into its restart loop. onExit does its job instead.
  const child = spawn(join(runner.dir, 'bin', 'Runner.Listener.exe'), ['run'], {
    cwd: runner.dir,
    // Gives the listener its own hidden console, so stopAll can send it Ctrl+C
    // without that also reaching this process, pnpm or the shell.
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  runner.child = child;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (text) => ingest(runner, text));
  child.stderr.on('data', (text) => ingest(runner, text));
  child.on('error', (error) => log(runner, red(error.message)));
  child.on('close', (code) => {
    if (runner.child === child) runner.child = null;
    if (runner.partial) {
      onLine(runner, runner.partial);
      runner.partial = '';
    }
    void onExit(runner, code ?? 1, runId);
  });
}

// Mirrors run-helper.cmd's handling of the listener's exit codes.
async function onExit(runner, code, runId) {
  runner.job = null;
  if (state.quitting) {
    setStatus(runner, 'stopped');
    finishIfStopped();
    return;
  }
  if (code === 2) {
    log(runner, yellow('Retryable error, relaunching in 5 seconds…'));
    setStatus(runner, 'restarting');
    await sleep(5000);
  } else if (code === 3 || code === 4) {
    log(runner, yellow('Runner is updating, relaunching once the update finishes…'));
    setStatus(runner, 'restarting');
    const flag = join(runner.dir, 'update.finished');
    for (let i = 0; i < 30 && !existsSync(flag); i++) await sleep(1000);
    rmSync(flag, { force: true });
  } else {
    log(runner, (code === 0 ? dim : red)(`Listener exited with code ${code}. Press r to restart.`));
    setStatus(runner, code === 0 ? 'stopped' : 'failed');
    return;
  }
  if (runId === runner.runId) start(runner);
}

export function restart(runner) {
  if (runner.child) {
    state.flash = `${runner.label} is already running`;
    scheduleRender();
    return;
  }
  start(runner);
}

// Attaches to each listener's console in turn and sends it Ctrl+C. The listener
// then cancels any job and deletes its session on GitHub before exiting.
const CTRL_C_SCRIPT = `
Add-Type -Namespace Win32 -Name Console -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern bool FreeConsole();
[DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
[DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(System.IntPtr handler, bool add);
[DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint ctrlEvent, uint group);
'@
[Win32.Console]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
foreach ($id in $args) {
  [Win32.Console]::FreeConsole() | Out-Null
  if ([Win32.Console]::AttachConsole([uint32]$id)) { [Win32.Console]::GenerateConsoleCtrlEvent(0, 0) | Out-Null }
}`;

function sendCtrlC(children) {
  spawn(
    join(system32, 'WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', `& {${CTRL_C_SCRIPT}} ${children.map((child) => child.pid).join(' ')}`],
    { windowsHide: true, stdio: 'ignore' },
  );
}

function killTree(child) {
  spawnSync(join(system32, 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
}

export function forceKill() {
  for (const runner of runners) {
    if (!runner.child) continue;
    log(runner, red('Force-killed. Its GitHub session expires on its own in a few minutes.'));
    killTree(runner.child);
  }
}

// First call stops every runner cleanly; a second one force-kills whatever is left.
export function quit() {
  if (state.quitting) {
    forceKill();
    return;
  }
  state.quitting = true;
  const running = runners.filter((runner) => runner.child);
  for (const runner of running) setStatus(runner, 'stopping');
  if (running.length) sendCtrlC(running.map((runner) => runner.child));
  setTimeout(forceKill, STOP_TIMEOUT_MS).unref();
  finishIfStopped();
}

function finishIfStopped() {
  if (!state.quitting || runners.some((runner) => runner.child)) return;
  restoreTerminal();
  console.log(`All ${runners.length} runners stopped.`);
  process.exit(0);
}

export function listenersAlreadyRunning() {
  const result = spawnSync(
    join(system32, 'tasklist.exe'),
    ['/FI', 'IMAGENAME eq Runner.Listener.exe', '/NH'],
    { encoding: 'utf8' },
  );
  return (result.stdout ?? '').includes('Runner.Listener.exe');
}
