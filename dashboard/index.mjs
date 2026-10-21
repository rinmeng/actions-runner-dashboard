// Runs every local GitHub Actions runner in one terminal, with a section per runner.
//
//   pnpm start (or `runners`)   click or ↑/↓ to pick a runner; q stops them all cleanly
//   pnpm web (or `runners-web`) the same in the browser (web/), Ctrl+C stops them all
//   pnpm web:tunnel             and a Cloudflare tunnel to it (dashboard/tunnel.mjs)
//
// No dependencies on purpose. Runners are the actions-runner, actions-runner-2, …
// folders with a .runner config in RUNNERS_HOME (default: the folder this repo is
// cloned into). `runners.sh status` shows what each one is doing on GitHub's side.

import { startApi } from './api.mjs';
import { forceKill, quit, runnersAlreadyRunning, start } from './runners.mjs';
import { home, plain, runners, scheduleRender, setRenderer, web } from './state.mjs';
import { restoreTerminal, setupTerminal } from './terminal.mjs';
import { onInput, render } from './ui.mjs';
import { startUsageSampler } from './usage.mjs';
import { publicUrl, startTunnel, stopTunnel } from './tunnel.mjs';
import { startWeb, stopSite } from './web.mjs';

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
}
if (!plain || web) {
  // Keeps the job timers ticking.
  setInterval(scheduleRender, 1000);
  startUsageSampler();
}
startApi();
const tunnel = web && process.argv.includes('--tunnel');
if (tunnel) startTunnel();
// With a tunnel, the public address is the one to open.
if (web) void startWeb((tunnel && publicUrl()) || undefined);
// The site and tunnel run in the background so Ctrl+C doesn't hit them mid-shutdown
// (the page shows "Stopping" until the runners are done), then go down with the runners.
// Without the machine, a Cloudflare Worker can show the offline page (cloudflare/).
if (web) {
  let stopped = false;
  const stopBackground = () => {
    if (stopped) return;
    stopped = true;
    if (tunnel) stopTunnel();
    stopSite();
  };
  process.on('exit', stopBackground);
  // Closing the window gives a process only seconds before Windows ends it, likely
  // before the runners finish stopping, so take these down first.
  process.on('SIGHUP', stopBackground);
}
for (const runner of runners) start(runner);
scheduleRender();
