// Runs only the web dashboard, without the runners, so it can stay up and say
// they're offline. `runners-web` starts this in the background when it isn't up yet.
//
//   pnpm site         serve it in the foreground
//   pnpm site:stop    stop it, wherever it was started

import { runSite, stopSite } from './web.mjs';

if (process.argv.includes('stop')) stopSite();
else runSite();
