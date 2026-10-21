// A Cloudflare tunnel to the web dashboard, for `--tunnel`. Runs `cloudflared tunnel run`,
// which reads ~/.cloudflared/config.yml, in the background like the site, so the site
// stays reachable (saying the runners are offline) after the runners stop.
//
//   node dashboard/tunnel.mjs stop    (pnpm tunnel:stop)

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { system32 } from './state.mjs';
import { dim, red } from './text.mjs';

// cloudflared's installer doesn't put it on PATH; CLOUDFLARED overrides.
const INSTALLED = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'cloudflared', 'cloudflared.exe');
const CLOUDFLARED = process.env.CLOUDFLARED ?? (existsSync(INSTALLED) ? INSTALLED : 'cloudflared');
const LOG_FILE = join(dirname(fileURLToPath(import.meta.url)), '../tunnel.log');

// Process ids of running `cloudflared … tunnel … run`, however they were started.
function tunnelProcesses() {
  const result = spawnSync(
    join(system32, 'WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { $_.CommandLine -match '\\btunnel\\b.*\\brun\\b' } | Select-Object -ExpandProperty ProcessId",
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  return (result.stdout ?? '').split(/\s+/).filter(Boolean);
}

export function startTunnel() {
  if (tunnelProcesses().length) {
    console.log(dim('Tunnel already running.'));
    return;
  }
  const child = spawn(CLOUDFLARED, ['tunnel', '--logfile', LOG_FILE, 'run'], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.on('error', (error) => console.error(red(`Tunnel not started (${CLOUDFLARED}): ${error.message}`)));
  child.unref();
  console.log(`Tunnel started ${dim(`(log: ${LOG_FILE}; pnpm tunnel:stop ends it)`)}`);
}

export function stopTunnel() {
  const pids = tunnelProcesses();
  if (!pids.length) {
    console.log('No tunnel is running.');
    return;
  }
  for (const pid of pids) spawnSync(join(system32, 'taskkill.exe'), ['/pid', pid, '/T', '/F'], { stdio: 'ignore' });
  console.log('Stopped the tunnel.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('stop')) {
  stopTunnel();
}
