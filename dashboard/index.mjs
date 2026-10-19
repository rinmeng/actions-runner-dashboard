// Runs every local GitHub Actions runner in one terminal, with a section per runner.
//
//   pnpm start (or `runners`)   click or ↑/↓ to pick a runner; q stops them all cleanly
//
// No dependencies on purpose. Runners are the actions-runner, actions-runner-2, …
// folders with a .runner config in RUNNERS_HOME (default: the folder this repo is
// cloned into). `runners.sh status` shows what each one is doing on GitHub's side.

import { forceKill, quit, runnersAlreadyRunning, start } from './runners.mjs';
import { home, plain, runners, scheduleRender, setRenderer } from './state.mjs';
import { restoreTerminal, setupTerminal } from './terminal.mjs';
import { onInput, render } from './ui.mjs';
import { startUsageSampler } from './usage.mjs';

if (runners.length === 0) {
  console.error(`No configured runners found in ${home}. Set RUNNERS_HOME to the folder that holds them.`);
  process.exit(1);
}
const alreadyRunning = runnersAlreadyRunning();
if (alreadyRunning.length) {
  console.error(`Already running (or still shutting down): ${alreadyRunning.join(', ')}. Wait for them to exit first.`);
  process.exit(1);
}

process.on('SIGINT', quit);
process.on('SIGTERM', quit);
process.on('SIGHUP', quit);
process.on('uncaughtException', (error) => {
  forceKill();
  restoreTerminal();
  console.error(error);
  process.exit(1);
});

if (!plain) {
  setRenderer(render);
  setupTerminal(onInput);
  // Keeps the job timers ticking.
  setInterval(scheduleRender, 1000);
  startUsageSampler();
}
for (const runner of runners) start(runner);
scheduleRender();
