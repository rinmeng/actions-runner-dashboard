// The Next.js web dashboard (web/). It runs as its own process (site.mjs) so it
// stays up, saying the runners are offline, after the runners stop.
// Builds it first when there is no build yet. After changing web/: `pnpm site:stop`
// (building under a running site breaks it), then `pnpm web:build`, then start it again.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { API_PORT } from './api.mjs';
import { system32 } from './state.mjs';
import { dim, red } from './text.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(HERE, '../web');
const NEXT_BIN = join(WEB_DIR, 'node_modules/next/dist/bin/next');
export const WEB_PORT = Number(process.env.RUNNERS_WEB_PORT ?? 3130);
// Local only by default: the tunnel (cloudflared) reaches it from this machine.
const WEB_HOST = process.env.RUNNERS_WEB_HOST ?? '127.0.0.1';
const URL_SHOWN = `http://${WEB_HOST === '0.0.0.0' ? 'localhost' : WEB_HOST}:${WEB_PORT}`;
const env = { ...process.env, RUNNERS_API_URL: `http://127.0.0.1:${API_PORT}` };

async function siteIsUp() {
  try {
    await fetch(URL_SHOWN, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

function ensureBuilt() {
  if (!existsSync(NEXT_BIN)) {
    console.error(red(`The web dashboard isn't installed. Run pnpm install in ${WEB_DIR}.`));
    return false;
  }
  if (existsSync(join(WEB_DIR, '.next/BUILD_ID'))) return true;
  console.log(dim('Building the web dashboard (first run only)…'));
  const build = spawnSync(process.execPath, [NEXT_BIN, 'build'], { cwd: WEB_DIR, env, stdio: 'inherit' });
  if (build.status === 0) return true;
  console.error(red('The web dashboard failed to build.'));
  return false;
}

// `pnpm site`: serves the dashboard in the foreground until Ctrl+C.
export function runSite() {
  if (!ensureBuilt()) process.exit(1);
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '-H', WEB_HOST, '-p', String(WEB_PORT)], {
    cwd: WEB_DIR,
    env,
    stdio: 'inherit',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => child.kill());
}

// `pnpm site:stop`: stops a site started in the background, by whoever listens on its port.
export function stopSite() {
  const result = spawnSync(
    join(system32, 'WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-NetTCPConnection -LocalPort ${WEB_PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  const pids = (result.stdout ?? '').split(/\s+/).filter(Boolean);
  if (!pids.length) {
    console.log(`Nothing is serving ${URL_SHOWN}.`);
    return;
  }
  for (const pid of pids) spawnSync(join(system32, 'taskkill.exe'), ['/pid', pid, '/T', '/F'], { stdio: 'ignore' });
  console.log(`Stopped the web dashboard at ${URL_SHOWN}.`);
}

// For `--web`: starts the site in the background unless it is already up, then opens
// it, or `openUrl` instead (the tunnel's public address) once that answers.
export async function startWeb(openUrl = URL_SHOWN) {
  if (!(await siteIsUp())) {
    if (!ensureBuilt()) {
      console.error(red('The runners carry on without the web dashboard.'));
      return;
    }
    spawn(process.execPath, [join(HERE, 'site.mjs')], {
      env,
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    }).unref();
  }
  console.log(`Web dashboard: ${openUrl} ${dim('(keeps running after the runners stop; pnpm site:stop ends it)')}`);
  if (process.env.RUNNERS_WEB_OPEN !== '0') void openWhenReady(openUrl);
}

// Opens the dashboard in the default browser once it answers there; through a tunnel,
// Cloudflare answers with an error until the tunnel connects.
async function openWhenReady(url) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    if (response?.ok) {
      spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
