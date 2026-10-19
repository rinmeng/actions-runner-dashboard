// Drawing the screen and handling keyboard and mouse input.

import { spawn } from 'node:child_process';

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

const elapsed = (since) => {
  const seconds = Math.floor((Date.now() - since) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const RESULT_MARK = { Succeeded: green('✓'), Failed: red('✗'), Canceled: dim('⊘') };

// One-line summary of a runner's current or last job.
function jobSummary(runner, { long }) {
  const job = runner.job ?? runner.last;
  if (!job) return dim(runner.status === 'idle' ? 'waiting for a job' : '');
  const mark = runner.job ? yellow('▶') : (RESULT_MARK[job.result] ?? dim(job.result ?? ''));
  if (!long) {
    const actor = job.actor ? ` ${bold(`@${job.actor}`)}` : '';
    return `${mark}${actor} ${job.workflow || job.name}`;
  }
  const who = job.actor ? ` ${bold(`@${job.actor}`)} ${prLink(runner, job)}` : '';
  const workflow = job.workflow ? `${job.workflow} › ` : '';
  const time = runner.job ? `  ${dim(elapsed(job.startedAt))}` : '';
  return `${mark} ${workflow}${bold(job.name)}${who}${time}`;
}

const GB = 1024 ** 3;
const gigabytes = (bytes) => `${(bytes / GB).toFixed(1)} GB`;
const percent = (value) => `${Math.round(value)}%`;
// Columns: label, then total / used / runners, right-aligned.
const usageRow = (label, total, used, runnersUsed) =>
  ` ${label.padEnd(5)}${total.padStart(9)}${used.padStart(9)}${yellow(runnersUsed.padStart(9))}`;

function usageRows() {
  const usage = state.usage;
  const header = { text: dim(` ${'System'.padEnd(5)}${'total'.padStart(8)}${'used'.padStart(9)}${'runners'.padStart(9)}`) };
  if (!usage) return [header, { text: dim(' sampling…') }];
  const { cpu, ram, gpu } = usage;
  const { peak } = state;
  return [
    header,
    { text: usageRow('CPU', `${usage.threads} thr`, percent(cpu.used), percent(cpu.runners)) },
    { text: usageRow('RAM', gigabytes(ram.total), gigabytes(ram.used), gigabytes(ram.runners)) },
    { text: usageRow('GPU', '', percent(gpu.used), percent(gpu.runners)) },
    { text: '' },
    // " Max this session" is 17 columns; "used" ends at column 24 like the rows.
    { text: dim(` Max this session${'used'.padStart(7)}${'runners'.padStart(9)}`) },
    { text: usageRow('CPU', '', percent(peak.cpu.used), percent(peak.cpu.runners)) },
    { text: usageRow('RAM', '', gigabytes(peak.ram.used), gigabytes(peak.ram.runners)) },
    { text: usageRow('GPU', '', percent(peak.gpu.used), percent(peak.gpu.runners)) },
  ];
}

function sidebarRows(height) {
  const count = (status) => runners.filter((runner) => runner.status === status).length;
  const rows = [
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
    rows.push({ text: `     ${jobSummary(runner, { long: false })}`, view: index });
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

