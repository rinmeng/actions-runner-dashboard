// Runs only the web dashboard, without the runners (it then says they're offline).
// `runners-web` starts this in the background when it isn't up yet, and stops it on exit.
//
//   pnpm site         serve it in the foreground
//   pnpm site:stop    stop it, wherever it was started

import { runSite, stopSite } from './web.mjs';

if (process.argv.includes('stop')) {
  stopSite();
} else {
  console.log(`${new Date().toISOString()} site starting (pid ${process.pid})`);
  process.on('exit', (code) => console.log(`${new Date().toISOString()} site exiting with code ${code}`));
  runSite();
}
