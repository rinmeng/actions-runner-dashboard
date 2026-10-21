// Drawing the screen and handling keyboard and mouse input.

import { spawn } from 'node:child_process';
import { uptime } from 'node:os';

import { prLink, quit, restart, tag } from './runners.mjs';
import {
  allView,
  HEADER_ROWS,
  LOG_COLUMN,
  runners,
  scheduleRender,
  scrollBy,
  select,
  selectedView,
  SIDEBAR_WIDTH,
  state,
  views,
} from './state.mjs';
import {
  bold,
  dim,
  fit,
  green,
  inverse,
  padEnd,
  red,
  RESET,
  stripAnsi,
  wrap,
  yellow,
} from './text.mjs';

const MOUSE_EVENT = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
const WHEEL_LINES = 3;
const FLASH_MS = 2000;

const STATUS_STYLE = {
  starting: dim,
  idle: green,
  busy: yellow,
  reconnecting: red,
  restarting: yellow,
  stopping: yellow,
  stopped: dim,
  failed: red,
};

const HELP = [
  ' ↑/↓ 0-9 click  switch',
  ' wheel a/z PgUp/PgDn  scroll',
  ' b bottom  w clear  r restart',
  ' click PR  open in browser',
  ' q quit (again to force)',
];

// "42s", or "3m 05s" past a minute.
function duration(ms) {
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

// "3d 04h 12m", dropping days while under a day.
function uptimeText(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = String(Math.floor((seconds % 86400) / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  return days ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
}

const RESULT_MARK = { Succeeded: green('✓'), Failed: red('✗'), Canceled: dim('⊘') };

// Summary of a runner's current or last job: one line for the header, or for
// the sidebar a list of lines, the actor with the workflow branching off it.
function jobSummary(runner, { long }) {
  const job = runner.job ?? runner.last;
  if (!job) {
    const waiting = dim(runner.status === 'idle' ? 'waiting for a job' : '');
    return long ? waiting : [waiting];
  }
  const mark = runner.job ? yellow('▶') : (RESULT_MARK[job.result] ?? dim(job.result ?? ''));
  // A running job counts up ("(42s)"), a finished one says how long it took ("(done in 42s)").
  // Unknown when the job started before the dashboard did.
  const time = !job.startedAt
    ? ''
    : runner.job
      ? dim(` (${duration(Date.now() - job.startedAt)})`)
      : dim(` (done in ${duration(job.finishedAt - job.startedAt)})`);
  if (!long) {
    const workflow = `${mark} ${job.workflow || job.name}${time}`;
    return job.actor ? [bold(`@${job.actor}`), `${dim('└')} ${workflow}`] : [workflow];
  }
  const who = job.actor ? ` ${bold(`@${job.actor}`)} ${prLink(job)}` : '';
  const workflow = job.workflow ? `${job.workflow} › ` : '';
  return `${mark} ${workflow}${bold(job.name)}${who}${time}`;
}

const GB = 1024 ** 3;
const gigabytes = (bytes) => `${(bytes / GB).toFixed(1)} GB`;
const percent = (value) => `${Math.round(value)}%`;
// Bytes per second as "840 KB/s" or "2.4 MB/s".
const speed = (bytes) =>
  bytes < 1024 ** 2 ? `${Math.round(bytes / 1024)} KB/s` : `${(bytes / 1024 ** 2).toFixed(1)} MB/s`;
const celsius = (value) => `${Math.round(value)}°C`;
// padStart that ignores color codes, like padEnd.
const padStart = (text, width) => ' '.repeat(Math.max(0, width - stripAnsi(text).length)) + text;
// Columns: label, then total / used / runners, right-aligned.
const usageRow = (label, total, used, runnersUsed) =>
  ` ${label.padEnd(6)}${total.padStart(11)}${used.padStart(11)}${yellow(runnersUsed.padStart(11))}`;

function usageRows() {
  const usage = state.usage;
  const header = { text: bold(` ${'System'.padEnd(6)}${'total'.padStart(11)}${'used'.padStart(11)}${'runners'.padStart(11)}`) };
  if (!usage) return [header, { text: dim(' sampling…') }];
  const { cpu, ram, gpu } = usage;
  const { peak } = state;
  return [
    header,
    { text: usageRow('CPU', `${usage.threads} thr`, percent(cpu.used), percent(cpu.runners)) },
    { text: usageRow('RAM', gigabytes(ram.total), gigabytes(ram.used), gigabytes(ram.runners)) },
    { text: usageRow('GPU', '', percent(gpu.used), percent(gpu.runners)) },
    { text: '' },
    // " Max this session" is 17 columns; "used" ends at column 29 like the rows.
    { text: bold(` Max this session${'used'.padStart(12)}${'runners'.padStart(11)}`) },
    { text: usageRow('CPU', '', percent(peak.cpu.used), percent(peak.cpu.runners)) },
    { text: usageRow('RAM', '', gigabytes(peak.ram.used), gigabytes(peak.ram.runners)) },
    { text: usageRow('GPU', '', percent(peak.gpu.used), percent(peak.gpu.runners)) },
    { text: '' },
    ...rangeTable('Temp', celsius, [
      ['CPU', 'temp.cpu'],
      ['GPU', 'temp.gpu'],
      ['Hot spot', 'temp.gpuHotSpot'],
      ['SSD', 'temp.ssd'],
    ]),
    { text: '' },
    ...rangeTable('Network', speed, [
      ['↓ Down', 'net.down'],
      ['↑ Up', 'net.up'],
    ]),
    { text: '' },
    // Free space lines up with the "now" column above.
    { text: ` ${bold(`Disk ${usage.disk.drive}`.padEnd(9))}${padStart(gigabytes(usage.disk.free), 10)}${dim(` free of ${gigabytes(usage.disk.total)}`)}` },
  ];
}

// A table of readings, each with its current value and its lowest and highest
// this session. `rows` are [label, "group.name"] pairs into state.usage.
function rangeTable(title, format, rows) {
  const show = (value) => (value == null ? dim('—') : format(value));
  const row = (label, now, min, max) =>
    ` ${label.padEnd(9)}${padStart(now, 10)}${padStart(min, 10)}${padStart(max, 10)}`;
  return [
    { text: bold(row(title, 'now', 'min', 'max')) },
    ...rows.map(([label, key]) => {
      const [group, name] = key.split('.');
      const range = state.range?.[key];
      return { text: row(label, show(state.usage[group][name]), show(range?.min), show(range?.max)) };
    }),
  ];
}

function sidebarRows(height) {
  const count = (status) => runners.filter((runner) => runner.status === status).length;
  const rows = [
    { text: ` ${bold('PC uptime')}  ${uptimeText(uptime())}` },
    { text: '' },
    ...usageRows(),
    { text: '' },
    { text: bold(' Actions runners') },
    { text: dim(` ${count('busy')} busy · ${count('idle')} idle · ${runners.length} total`) },
    { text: '' },
  ];
  const item = (index, text) => ({
    text: index === state.selectedIndex ? inverse(padEnd(stripAnsi(text), SIDEBAR_WIDTH)) : text,
    view: index,
  });

  rows.push(item(0, ' 0   All runners'), { text: '' });
  runners.forEach((runner, position) => {
    const index = position + 1;
    const style = STATUS_STYLE[runner.status];
    const marker = runner.unread ? yellow(' •') : '';
    const name = `${index < 10 ? index : ' '} ${style('●')} ${runner.label}${marker}`;
    const status = style(runner.status);
    const gap = SIDEBAR_WIDTH - 1 - stripAnsi(name).length - runner.status.length;
    rows.push(item(index, ` ${name}${' '.repeat(Math.max(1, gap))}${status}`));
    for (const line of jobSummary(runner, { long: false })) rows.push({ text: `     ${line}`, view: index });
    rows.push({ text: '' });
  });

  while (rows.length < height - HELP.length) rows.push({ text: '' });
  return [...rows, ...HELP.map((line) => ({ text: dim(line) }))].slice(0, height);
}

function headerRows(view) {
  const scrolled = view.scroll > 0 ? yellow(`  ↑ ${view.scroll} lines up, b to go to bottom`) : '';
  const notice = state.quitting
    ? yellow('  Stopping: waiting for each runner to end its GitHub session (q again to force)')
    : state.flash
      ? `  ${green(state.flash)}`
      : scrolled;

  if (view === allView) {
    return [
      `${bold(allView.label)}${notice}`,
      dim('Click a runner on the left (or press its number) to see only its logs.'),
    ];
  }
  const status = STATUS_STYLE[view.status](view.status);
  return [`${bold(view.label)}  ${status}  ${dim(view.name)}${notice}`, jobSummary(view, { long: true })];
}

function logRows(view, width, height) {
  const bodyHeight = height - HEADER_ROWS;
  const body = [];
  for (
    let index = view.lines.length - 1 - view.scroll;
    index >= 0 && body.length < bodyHeight;
    index--
  ) {
    const entry = view.lines[index];
    const text = view === allView ? `${tag(entry.runner)} ${entry.text}` : entry.text;
    const rows = wrap(text, width);
    for (let row = rows.length - 1; row >= 0 && body.length < bodyHeight; row--) {
      body.unshift(rows[row]);
    }
  }
  while (body.length < bodyHeight) body.unshift({ text: '', links: [] });
  return [...headerRows(view).map((text) => fit(text, width)), ...body];
}

export function render() {
  const width = process.stdout.columns || 80;
  const height = process.stdout.rows || 24;
  const logWidth = Math.max(10, width - SIDEBAR_WIDTH - 2);

  const sidebar = sidebarRows(height);
  const logs = logRows(selectedView(), logWidth, height);
  state.sidebarTargets = sidebar.map((row) => row.view);
  state.linkAreas = [];

  let frame = '';
  for (let row = 0; row < height; row++) {
    const log = logs[row] ?? { text: '', links: [] };
    for (const { from, to, url } of log.links) {
      state.linkAreas.push({ y: row + 1, from: LOG_COLUMN + from, to: LOG_COLUMN + to, url });
    }
    frame +=
      `\x1b[${row + 1};1H` +
      padEnd(fit(sidebar[row]?.text ?? '', SIDEBAR_WIDTH).text, SIDEBAR_WIDTH) +
      dim('│') +
      ' ' +
      log.text +
      RESET +
      '\x1b[K';
  }
  process.stdout.write(frame);
}

let flashTimer = null;
function showFlash(message) {
  state.flash = message;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    state.flash = null;
    scheduleRender();
  }, FLASH_MS);
  scheduleRender();
}

function openUrl(url) {
  spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
  showFlash(`Opened ${url}`);
}

// `button` is the SGR mouse code: bit 64 is the wheel, the low two bits the
// button (0 = left). Bits 4/8/16 are modifier keys.
function onMouse(button, x, y, released) {
  const base = button & ~(4 | 8 | 16);
  if (base & 64) {
    scrollBy(base & 1 ? -WHEEL_LINES : WHEEL_LINES);
    return;
  }
  if (released || (base & 3) !== 0) return;

  if (x <= SIDEBAR_WIDTH) {
    const view = state.sidebarTargets[y - 1];
    if (view !== undefined) select(view);
    return;
  }
  const area = state.linkAreas.find((link) => link.y === y && x >= link.from && x < link.to);
  if (area) openUrl(area.url);
}

export function onInput(data) {
  let mouseEvents = 0;
  for (const [, button, x, y, kind] of data.matchAll(MOUSE_EVENT)) {
    mouseEvents++;
    onMouse(Number(button), Number(x), Number(y), kind === 'm');
  }
  if (mouseEvents === 0) onKey(data);
}

function onKey(key) {
  const page = Math.max(1, (process.stdout.rows || 24) - HEADER_ROWS - 1);
  const view = selectedView();
  switch (key) {
    case '\x03':
    case 'q':
      quit();
      scheduleRender();
      break;
    case '\x1b[A':
    case 'k':
      select(state.selectedIndex - 1);
      break;
    case '\x1b[B':
    case 'j':
    case '\t':
      select(state.selectedIndex + 1);
      break;
    case '\x1b[1;2A':
    case 'a':
      scrollBy(1);
      break;
    case '\x1b[1;2B':
    case 'z':
      scrollBy(-1);
      break;
    case '\x1b[5~':
      scrollBy(page);
      break;
    case '\x1b[6~':
      scrollBy(-page);
      break;
    case '\x1b[H':
    case '\x1b[1~':
    case 'g':
      scrollBy(view.lines.length);
      break;
    case '\x1b[F':
    case '\x1b[4~':
    case 'b':
      view.scroll = 0;
      scheduleRender();
      break;
    case 'r':
      if (view === allView) showFlash('Select a runner first, then press r');
      else restart(view);
      break;
    case 'w':
      view.lines = [];
      view.scroll = 0;
      scheduleRender();
      break;
    default:
      if (/^[0-9]$/.test(key) && Number(key) < views.length) select(Number(key));
  }
}

