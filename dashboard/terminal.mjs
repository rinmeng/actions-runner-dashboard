// Switching the terminal into and out of the full-screen UI.

import { plain, scheduleRender } from './state.mjs';

let active = false;

export function setupTerminal(onInput) {
  // Mode 1000 reports clicks and the wheel (otherwise the wheel becomes ↑/↓ in the
  // alternate screen); 1006 makes the reports parseable at any column.
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[?1000h\x1b[?1006h');
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onInput);
  process.stdin.resume();
  process.stdout.on('resize', scheduleRender);
  active = true;
}

export function restoreTerminal() {
  if (plain || !active) return;
  active = false;
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l');
}
