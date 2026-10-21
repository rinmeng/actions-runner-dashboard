// Starting and stopping the runners, and tracking what each one is doing from its output.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  allView,
  events,
  MAX_LINES,
  plain,
  runners,
  scheduleRender,
  selectedView,
  state,
  system32,
  gitBashDir,
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

let lastLineId = 0;

// Entries are shared by the runner's view and the "All runners" view, so a
// line rewritten later (see describeJob) changes in both. Without the terminal
// UI they are still kept, for the web dashboard.
function push(runner, text) {
  const entry = { id: ++lastLineId, at: Date.now(), runner, text };
  if (plain) process.stdout.write(`${tag(runner)} ${text}${RESET}\n`);
  append(runner, entry);
  append(allView, entry);
  if (!plain && runner !== selectedView()) runner.unread = true;
  events.emit('line', entry);
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
    runner.last = { ...runner.job, name: match[1], result: match[2], finishedAt: Date.now() };
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
    // From the job rather than .runner, which holds an org URL for org-level runners.
    repoUrl: `${values.server_url ?? 'https://github.com'}/${values.repository}`,
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

export const prLink = (job) =>
  job.pr ? link(`${job.repoUrl}/pull/${job.pr}`, `PR #${job.pr}`) : job.event;

// Rewrites "<time>: Running job: X" into "<time> @user (PR #n) requested: Workflow › X".
async function describeJob(runner, job, entry, timestamp) {
  const context = await waitForJobContext(runner);
  if (!context) return;
  Object.assign(job, context);
  if (runner.last && runner.last.startedAt === job.startedAt) Object.assign(runner.last, context);
  entry.text = `${timestamp} ${bold(`@${job.actor}`)} (${prLink(job)}) requested: ${job.workflow} › ${bold(job.name)}`;
  if (plain) process.stdout.write(`${tag(runner)} ${entry.text}${RESET}\n`);
  events.emit('line-update', entry);
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
    // `shell: bash` steps run the first bash.exe on PATH. Launched from Explorer, that is
    // System32's WSL bash, which mangles the Windows script path, so put Git Bash first.
    env: { ...process.env, PATH: `${gitBashDir};${process.env.PATH}` },
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

// Labels of our runners that already have a listener running, from an earlier
// session still shutting down or started some other way. Listeners of unrelated
// runners (e.g. one installed as a service elsewhere) are ignored, unless Windows
// won't say where a listener runs from: then it might be ours.
export function runnersAlreadyRunning() {
  const result = spawnSync(
    join(system32, 'WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-Process Runner.Listener -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Path) { $_.Path } else { '?' } }",
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  const paths = (result.stdout ?? '').split(/\r?\n/).map((path) => path.trim().toLowerCase()).filter(Boolean);
  const labels = runners
    .filter((runner) => paths.includes(join(runner.dir, 'bin', 'Runner.Listener.exe').toLowerCase()))
    .map((runner) => runner.label);
  const unknown = paths.filter((path) => path === '?').length;
  if (unknown) labels.push(`${unknown} listener(s) whose folder Windows won't reveal`);
  return labels;
}
