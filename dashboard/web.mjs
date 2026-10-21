// Starts the Next.js web dashboard (web/) next to the runners, for `--web`.
// Builds it first when there is no build yet; `pnpm build` in web/ after changing it.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { API_PORT } from './api.mjs';
import { dim, red } from './text.mjs';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '../web');
const NEXT_BIN = join(WEB_DIR, 'node_modules/next/dist/bin/next');
export const WEB_PORT = Number(process.env.RUNNERS_WEB_PORT ?? 3130);
// Local only by default: the tunnel (cloudflared) reaches it from this machine.
const WEB_HOST = process.env.RUNNERS_WEB_HOST ?? '127.0.0.1';

export function startWeb() {
  if (!existsSync(NEXT_BIN)) {
    console.error(red(`The web dashboard isn't installed. Run pnpm install in ${WEB_DIR}.`));
    return;
  }
  const env = { ...process.env, RUNNERS_API_URL: `http://127.0.0.1:${API_PORT}` };
  if (!existsSync(join(WEB_DIR, '.next/BUILD_ID'))) {
    console.log(dim('Building the web dashboard (first run only)…'));
    const build = spawnSync(process.execPath, [NEXT_BIN, 'build'], { cwd: WEB_DIR, env, stdio: 'inherit' });
    if (build.status !== 0) {
      console.error(red('The web dashboard failed to build; the runners carry on without it.'));
      return;
    }
  }
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '-H', WEB_HOST, '-p', String(WEB_PORT)], {
    cwd: WEB_DIR,
    env,
    windowsHide: true,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code) => {
    if (code) console.error(red(`The web dashboard exited with code ${code}; the runners carry on without it.`));
  });
  process.on('exit', () => child.kill());
  const url = `http://${WEB_HOST === '0.0.0.0' ? 'localhost' : WEB_HOST}:${WEB_PORT}`;
  console.log(`Web dashboard: ${url}`);
  if (process.env.RUNNERS_WEB_OPEN !== '0') void openWhenReady(url);
}

// Opens the dashboard in the default browser once the server answers.
async function openWhenReady(url) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
