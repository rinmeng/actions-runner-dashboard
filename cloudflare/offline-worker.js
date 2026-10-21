// A Cloudflare Worker for the dashboard's hostname (e.g. services.web8th.com/*). It passes
// every request through to the tunnel as usual, and when the machine can't answer (site
// down, PC asleep or off, tunnel gone) serves this offline page instead of Cloudflare's
// "Host Error". /api/status answers { online: false }, so the runner-status workflow
// still reports the runners as offline.
//
// Set up in the Cloudflare dashboard: Workers & Pages > Create > Worker, paste this file,
// deploy, then the worker's Settings > Domains & Routes > Add route: services.web8th.com/*
// (zone web8th.com). The free plan's 100,000 requests a day is plenty.

// Same wording as the dashboard's own offline screen (web/.env.local).
const OWNER = 'Rin';
const HOURS = "Usually it's active 9 am to 9 pm Pacific.";

// Cloudflare's own codes for an origin it couldn't reach, plus a plain bad gateway.
const ORIGIN_DOWN = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);
// Marks responses this worker made up, so the offline page can tell when the machine is back.
const OFFLINE_HEADER = 'x-runners-offline';
const CHECK_SECONDS = 30;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Actions runners</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #0a0a0a; --muted: #737373; --tile: #f5f5f5; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --fg: #fafafa; --muted: #a3a3a3; --tile: #262626; } }
  body { margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 24px; box-sizing: border-box;
         background: var(--bg); color: var(--fg); font: 14px/1.6 Inter, ui-sans-serif, system-ui, sans-serif; text-align: center; }
  main { max-width: 26rem; display: grid; justify-items: center; gap: 8px; }
  .icon { width: 40px; height: 40px; border-radius: 12px; background: var(--tile); display: grid; place-items: center; margin-bottom: 8px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0; }
  p { margin: 0; color: var(--muted); }
  .hours { color: var(--fg); font-weight: 500; }
  small { color: var(--muted); margin-top: 12px; font-size: 12px; }
</style>
</head>
<body>
<main>
  <div class="icon" aria-hidden="true">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64A9 9 0 0 1 20.77 15"/><path d="M6.16 6.16a9 9 0 1 0 12.68 12.68"/><path d="M12 2v4"/><path d="m2 2 20 20"/></svg>
  </div>
  <h1>${OWNER}'s runners are offline</h1>
  <p>Jobs for these runners wait in GitHub's queue until they're back. Ping ${OWNER} to turn them on.</p>
  <p class="hours">${HOURS}</p>
  <small>This page updates on its own once they're back.</small>
</main>
<script>
  // Checks in the background and reloads only once the machine answers: anything this
  // worker serves itself carries the ${OFFLINE_HEADER} header.
  setInterval(async () => {
    try {
      const response = await fetch('/', { method: 'HEAD', cache: 'no-store' });
      if (!response.headers.has('${OFFLINE_HEADER}')) location.reload();
    } catch {}
  }, ${CHECK_SECONDS * 1000});
</script>
</body>
</html>`;

export default {
  async fetch(request) {
    const response = await fetch(request).catch(() => null);
    if (response && !ORIGIN_DOWN.has(response.status)) return response;

    const { pathname } = new URL(request.url);
    const headers = { 'Cache-Control': 'no-store', 'Retry-After': String(CHECK_SECONDS), [OFFLINE_HEADER]: '1' };
    if (pathname === '/api/status') {
      return Response.json({ online: false, busy: 0, idle: 0, total: 0, runners: [] }, { headers });
    }
    if (pathname.startsWith('/api/')) return new Response('Offline', { status: 503, headers });
    return new Response(PAGE, { status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  },
};
