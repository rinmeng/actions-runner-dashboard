// A Cloudflare Worker for the dashboard's hostname (e.g. services.web8th.com/*). It passes
// every request through to the tunnel as usual, and when the machine can't answer (site
// down, PC asleep or off, tunnel gone) serves this offline page instead of Cloudflare's
// "Host Error". /api/status answers { online: false }, so the runner-status workflow
// still reports the runners as offline.
//
// The page is a static copy of the web dashboard (web/): the same sidebar, header, stat
// cards and log panel, with every reading blank and the status badge saying Offline.
// Keep it in step when the dashboard's layout changes.
//
// Set up in the Cloudflare dashboard: Workers & Pages > Create > Worker, paste this file,
// deploy, then the worker's Settings > Domains & Routes > Add route: services.web8th.com/*
// (zone web8th.com), as a Route, not a Custom Domain. The free plan's 100,000 requests a
// day is plenty. To redeploy on push instead of pasting, connect the Worker to this repo
// (Settings > Build) with root directory "cloudflare"; wrangler.jsonc is its config.

// Same wording as the dashboard's own offline screen (web/.env.local).
const OWNER = 'Rin';
const HOURS = "Usually it's active 9 am to 9 pm Pacific.";
// How many runners the sidebar lists; the Worker can't ask the machine.
const RUNNER_COUNT = 8;

// Cloudflare's own codes for an origin it couldn't reach, plus a plain bad gateway.
const ORIGIN_DOWN = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);
// Marks responses this worker made up, so the offline page can tell when the machine is back.
const OFFLINE_HEADER = 'x-runners-offline';
const CHECK_SECONDS = 30;

// Lucide icons, as the dashboard uses them.
const ICONS = {
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  server:
    '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>',
  layers:
    '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  ram: '<path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/><path d="M8 11V9"/><path d="M16 11V9"/><path d="M12 11V9"/><path d="M2 15h20"/><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.837V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.837Z"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  thermometer: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  network:
    '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  disk: '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01"/><path d="M10 16h.01"/>',
  terminal: '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2"/>',
};
const icon = (name, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const DASH = '—';

const runnerItems = Array.from(
  { length: RUNNER_COUNT },
  (_, index) => `
      <li class="runner">
        <span class="row"><span class="dot"></span><b>runner ${index + 1}</b><span class="state">offline</span></span>
        <span class="job">Not running</span>
      </li>`,
).join('');

// CPU, RAM or GPU, with nothing to show.
const usageCard = (title, iconName) => `
    <section class="card">
      <div class="card-title">${icon(iconName)}<h2>${title}</h2></div>
      <div class="big-row"><span class="big">${DASH}</span><span class="small">runners <b class="amber">${DASH}</b></span></div>
      <div class="bar"></div>
      <div class="max"><span class="max-label">Max</span><span><i class="dot-sm dot-all"></i>all <b>${DASH}</b></span><span><i class="dot-sm dot-runners"></i>runners <b class="amber">${DASH}</b></span></div>
    </section>`;

const rangeCard = (title, iconName, rows) => `
    <section class="card">
      <div class="card-title">${icon(iconName)}<h2>${title}</h2></div>
      <table>
        <thead><tr><th></th><th>now</th><th>min</th><th>max</th></tr></thead>
        <tbody>${rows.map((row) => `<tr><td>${row}</td><td class="now">${DASH}</td><td>${DASH}</td><td>${DASH}</td></tr>`).join('')}</tbody>
      </table>
    </section>`;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Actions runners</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">
<script>
  // The dashboard's theme choice (next-themes keeps it under "theme" on this same origin),
  // else the system's.
  try {
    const theme = localStorage.getItem('theme');
    const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch {}
</script>
<style>
  :root {
    color-scheme: light;
    --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); --card: oklch(1 0 0);
    --muted: oklch(0.97 0 0); --muted-foreground: oklch(0.556 0 0); --border: oklch(0.922 0 0);
    --sidebar: oklch(0.985 0 0); --accent: oklch(0.97 0 0); --primary: oklch(0.205 0 0);
    --ring: oklch(0.145 0 0 / 5%); --amber: oklch(0.666 0.179 58.318); --red: oklch(0.637 0.237 25.331);
  }
  .dark {
    color-scheme: dark;
    --background: oklch(0.145 0 0); --foreground: oklch(0.985 0 0); --card: oklch(0.205 0 0);
    --muted: oklch(0.269 0 0); --muted-foreground: oklch(0.708 0 0); --border: oklch(1 0 0 / 10%);
    --sidebar: oklch(0.205 0 0); --accent: oklch(0.269 0 0); --primary: oklch(0.922 0 0);
    --ring: oklch(0.985 0 0 / 10%); --amber: oklch(0.828 0.189 84.429);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--background); color: var(--foreground);
         font: 14px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; }
  h1, h2, p { margin: 0; }
  b { font-weight: 600; }
  .amber { color: var(--amber); }
  .muted { color: var(--muted-foreground); }
  .layout { display: flex; min-height: 100svh; }

  /* Sidebar: beside the page from 768px, a drawer below that. */
  aside { width: 19rem; flex-shrink: 0; background: var(--sidebar); border-right: 1px solid var(--border);
          position: sticky; top: 0; height: 100svh; overflow-y: auto; }
  .side-head { padding: 16px 16px 8px; display: grid; gap: 4px; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 600; }
  .side-head p { font-size: 12px; color: var(--muted-foreground); }
  .side-sep { height: 1px; background: var(--border); margin: 0 8px; }
  .all { margin: 8px; padding: 8px; border-radius: 10px; background: var(--accent); display: flex; align-items: center;
         gap: 8px; font-weight: 500; }
  .group-label { padding: 8px 16px 4px; font-size: 12px; font-weight: 500; color: var(--muted-foreground); }
  .runners { list-style: none; margin: 0; padding: 0 8px 16px; display: grid; gap: 4px; }
  .runner { padding: 8px; border-radius: 10px; display: grid; gap: 4px; }
  .runner .row { display: flex; align-items: center; gap: 8px; }
  .runner b { font-weight: 500; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted-foreground); opacity: .5; flex-shrink: 0; }
  .state { margin-left: auto; font-size: 12px; color: var(--muted-foreground); }
  .job { padding-left: 16px; font-size: 12px; color: var(--muted-foreground); }
  .scrim { display: none; }
  @media (max-width: 767px) {
    aside { position: fixed; z-index: 20; left: 0; transform: translateX(-100%); transition: transform .2s; }
    .open aside { transform: none; }
    .open .scrim { display: block; position: fixed; inset: 0; z-index: 10; background: rgb(0 0 0 / 50%); }
  }
  @media (min-width: 768px) { .collapsed aside { display: none; } }

  main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .icon-btn { width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 8px;
              background: none; color: inherit; cursor: pointer; }
  .icon-btn:hover { background: var(--accent); }
  .vsep { width: 1px; height: 16px; background: var(--border); margin-right: 4px; }
  .titles { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
  .title-text { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .title-text h1 { font-size: 16px; font-weight: 600; }
  .title-text p { font-size: 12px; color: var(--muted-foreground); }
  .status { display: flex; align-items: center; gap: 8px; }
  .uptime { display: flex; align-items: center; gap: 6px; color: var(--muted-foreground); }
  .uptime b { color: var(--foreground); }
  .uptime-lines { display: grid; line-height: 1.25; }
  .time { font-size: 12px; font-variant-numeric: tabular-nums; }
  .badge { height: 28px; padding: 0 10px; display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--border);
           border-radius: 999px; font-weight: 500; }
  .badge .live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); }
  .dark .sun, :root:not(.dark) .moon { display: block; }
  .sun, .moon { display: none; }
  /* Phones: the status and theme toggle go on a row under the title, as on the dashboard. */
  @media (max-width: 639px) {
    header { align-items: flex-start; }
    .vsep { margin-top: 6px; }
    .titles { flex-direction: column; align-items: stretch; }
    .title-text p, .uptime-label { display: none; }
  }

  .content { flex: 1; display: flex; flex-direction: column; gap: 16px; padding: 16px; }
  .grid { display: grid; gap: 12px; }
  @media (min-width: 640px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (min-width: 1024px) { .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .card { background: var(--card); border-radius: 1.625rem; padding: 16px; display: grid; gap: 8px; align-content: start;
          box-shadow: 0 4px 6px -1px rgb(0 0 0 / 10%), 0 2px 4px -2px rgb(0 0 0 / 10%), 0 0 0 1px var(--ring); }
  .card-title { display: flex; align-items: center; gap: 8px; }
  .card-title svg { color: var(--muted-foreground); }
  .card-title h2 { font-size: 14px; font-weight: 500; }
  .big-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .big { font-size: 24px; font-weight: 600; }
  .small { font-size: 12px; color: var(--muted-foreground); }
  .bar { height: 6px; border-radius: 999px; background: var(--muted); }
  .max { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--muted-foreground); white-space: nowrap; }
  .max b { color: var(--foreground); }
  .max b.amber { color: var(--amber); }
  .max-label { font-weight: 500; letter-spacing: .05em; text-transform: uppercase; }
  .max span { display: flex; align-items: center; gap: 6px; }
  .dot-sm { display: block; flex: none; width: 6px; height: 6px; border-radius: 50%; }
  .dot-all { background: var(--primary); }
  .dot-runners { background: oklch(0.769 0.188 70.08); }
  table { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
  th { font-weight: 400; color: var(--muted-foreground); text-align: right; height: 28px; border-bottom: 1px solid var(--border); }
  td { padding: 4px 0; text-align: right; color: var(--muted-foreground); }
  td:first-child { text-align: left; }
  td.now { color: var(--foreground); font-size: 14px; font-weight: 500; }

  .log { min-height: 24rem; flex: 1; display: flex; flex-direction: column; border-radius: 12px; background: var(--card);
         box-shadow: 0 0 0 1px var(--ring); overflow: hidden; }
  .log-head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 10px; border-bottom: 1px solid var(--border);
              color: var(--muted-foreground); font-size: 12px; }
  .log-head b { color: var(--foreground); font-weight: 500; display: flex; align-items: center; gap: 6px; }
  .log pre { margin: 0; padding: 12px; font: 12.5px/20px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
             white-space: pre-wrap; word-break: break-word; }
  .log .err { color: var(--red); }
  .log .dim { color: var(--muted-foreground); }
</style>
</head>
<body>
<div class="layout" id="layout">
  <aside>
    <div class="side-head">
      <div class="brand">${icon('server')}Actions runners</div>
      <p>0 busy · 0 idle · ${RUNNER_COUNT} total</p>
    </div>
    <div class="side-sep"></div>
    <div class="all">${icon('layers')}All runners</div>
    <div class="group-label">Runners</div>
    <ul class="runners">${runnerItems}
    </ul>
  </aside>
  <div class="scrim" id="scrim"></div>
  <main>
    <header>
      <button class="icon-btn" id="sidebar" aria-label="Toggle sidebar">${icon('panel')}</button>
      <span class="vsep"></span>
      <div class="titles">
        <div class="title-text">
          <h1>All runners</h1>
          <p>Every runner's output as it happens. Pick one on the left to see only its logs.</p>
        </div>
        <div class="status">
          <span class="uptime">${icon('clock')}<span class="uptime-lines"><span title="PC uptime"><span class="uptime-label">PC uptime </span><b>${DASH}</b></span><span class="time" id="time"></span></span></span>
          <span class="badge"><span class="live-dot"></span>Offline</span>
          <button class="icon-btn" id="theme" aria-label="Toggle dark mode"><span class="sun">${icon('sun')}</span><span class="moon">${icon('moon')}</span></button>
        </div>
      </div>
    </header>
    <div class="content">
      <div class="grid">
        ${usageCard('CPU', 'cpu')}
        ${usageCard('RAM', 'ram')}
        ${usageCard('GPU', 'gauge')}
        ${rangeCard('Temperature', 'thermometer', ['CPU', 'GPU', 'Hot spot', 'RAM', 'SSD'])}
        ${rangeCard('Network', 'network', ['↓ Down', '↑ Up'])}
        <section class="card">
          <div class="card-title">${icon('disk')}<h2>Disk</h2></div>
          <div class="big-row"><span class="big">${DASH}</span><span class="small">free</span></div>
          <div class="bar"></div>
          <div class="max">${DASH} used</div>
        </section>
      </div>
      <section class="log">
        <div class="log-head"><b>${icon('terminal', 14)}All runners' output</b>4 lines</div>
<pre><span class="err">● ${OWNER}'s runners are offline.</span>
Jobs for these runners wait in GitHub's queue until they're back. Ping ${OWNER} to turn them on.
<b>${HOURS}</b>
<span class="dim">This page updates on its own once they're back.</span></pre>
      </section>
    </div>
  </main>
</div>
<script>
  // The time in Pacific, under the uptime as on the dashboard.
  const pacific = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const tick = () => (document.getElementById('time').textContent = pacific.format(new Date()) + ' PT');
  tick();
  setInterval(tick, 1000);
  const layout = document.getElementById('layout');
  const phone = matchMedia('(max-width: 767px)');
  document.getElementById('sidebar').onclick = () => layout.classList.toggle(phone.matches ? 'open' : 'collapsed');
  // Tapping the scrim or anything in the drawer closes it, as the dashboard's sheet does.
  document.getElementById('scrim').onclick = () => layout.classList.remove('open');
  document.querySelector('aside').onclick = () => layout.classList.remove('open');
  document.getElementById('theme').onclick = () => {
    const dark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
  };
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
