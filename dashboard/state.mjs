// State shared by the modules. Mutable values live on `state` because importers
// can't reassign an imported `let`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const system32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
export const plain = !process.stdout.isTTY || !process.stdin.isTTY;
export const MAX_LINES = 5000;
export const SIDEBAR_WIDTH = 42;
// 1-based screen column where log text starts: sidebar, border, one space.
export const LOG_COLUMN = SIDEBAR_WIDTH + 3;
// Rows above the log text in the right pane.
export const HEADER_ROWS = 2;

const COLORS = ['31', '32', '33', '34', '35', '36', '91', '92', '93', '94', '95', '96'];

// Runner installs live next to each other: actions-runner, actions-runner-2, … in
// RUNNERS_HOME, or by default the folder this repo is cloned into.
export const home = process.env.RUNNERS_HOME ?? join(dirname(fileURLToPath(import.meta.url)), '../..');
const RUNNER_DIR = /^actions-runner(?:-(\d+))?$/;

function findRunners() {
  return readdirSync(home, { withFileTypes: true })
    .map((entry) => ({ entry, match: entry.isDirectory() && RUNNER_DIR.exec(entry.name) }))
    .filter(({ entry, match }) => match && existsSync(join(home, entry.name, '.runner')))
    .map(({ entry, match }) => {
      const dir = join(home, entry.name);
      const config = JSON.parse(readFileSync(join(dir, '.runner'), 'utf8').replace(/^\uFEFF/, ''));
      return { number: Number(match[1] ?? 1), dir, name: config.agentName };
    })
    .sort((a, b) => a.number - b.number);
}

export const runners = findRunners().map((runner, index) => ({
  ...runner,
  label: `runner ${runner.number}`,
  color: COLORS[index % COLORS.length],
  lines: [],
  // Lines trimmed off the front of `lines`.
  dropped: 0,
  partial: '',
  status: 'idle',
  child: null,
  runId: 0,
  // The job in progress and the last finished one: { name, startedAt, finishedAt, actor, event, pr, workflow, result }.
  job: null,
  last: null,
  // Newest Worker_*.log already matched to a job, so the next job waits for a newer one.
  workerLog: null,
  scroll: 0,
  unread: false,
}));

// The first view interleaves every runner's lines, like a plain console.
export const allView = { label: 'All runners', lines: [], dropped: 0, scroll: 0 };
export const views = [allView, ...runners];

export const state = {
  selectedIndex: 0,
  quitting: false,
  flash: null,
  // What the last frame drew, so mouse clicks map back to a view or a link.
  sidebarTargets: [],
  linkAreas: [],
};

export const selectedView = () => views[state.selectedIndex];

let renderer = () => {};
let renderPending = false;

export function setRenderer(render) {
  renderer = render;
}

export function scheduleRender() {
  if (plain || renderPending) return;
  renderPending = true;
  setTimeout(() => {
    renderPending = false;
    renderer();
  }, 33);
}

export function select(index) {
  state.selectedIndex = (index + views.length) % views.length;
  selectedView().unread = false;
  scheduleRender();
}

export function scrollBy(lines) {
  const view = selectedView();
  view.scroll = Math.max(0, Math.min(view.scroll + lines, view.lines.length - 1));
  scheduleRender();
}
