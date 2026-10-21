# actions-runner-dashboard

Set up and run several self-hosted GitHub Actions runners on one Windows machine,
watched from a terminal dashboard or a web dashboard. The runners and the terminal
dashboard are plain Node with no dependencies; the web dashboard (`web/`) is Next.js
with shadcn/ui.

- **Setup:** one command downloads the runner (checksum-verified) and creates and
  registers as many runner folders as you want, for a repo or an org.
- **Dashboard:** a sidebar with every runner's status and its current or last job
  (`✓ @user Workflow`). Click a runner, or press its number, to see only its logs;
  `0` shows them all.
- **Who and which PR:** each job start shows who asked for it, with a clickable PR link:
  `2026-10-19 21:39:59Z @user (PR #210) requested: Frontend CI › Lint, format & typecheck`
- **Usage:** live CPU, RAM and GPU use for the whole machine and for the runners' own
  process trees, plus the max seen this session; disk space, network speed and
  temperatures with their session min and max.
- **Clean shutdown:** `q` / Ctrl+C stops every runner cleanly so each one ends its
  GitHub session. Force-killing a runner leaves the session behind, and the next
  start fails with "A session for this runner already exists".

## Requirements

- Windows 10 1709 or newer (Windows 11 recommended).
- Node 18.14+. `npm` or `pnpm` both work.
- [`gh`](https://cli.github.com/), signed in (`gh auth login`), for setup and `status`.
  Setup needs admin on the repo, or permission to manage the org's runners.
- A terminal with mouse support: Windows Terminal or Git Bash. `status`/`watch` need bash.

## Quick start

Make a folder to hold everything and clone this repo into it. The runners are
created next to the clone:

```sh
mkdir ~/actions-runners && cd ~/actions-runners
git clone https://github.com/rinmeng/actions-runner-dashboard
cd actions-runner-dashboard

# 4 runners for a repo, with a label your workflows can target (runs-on: my-pc)
pnpm setup-runners --repo owner/repo --count 4 --labels my-pc

pnpm start
```

```
~/actions-runners/
├── actions-runner/
├── actions-runner-2/
├── …
└── actions-runner-dashboard/   ← this repo
```

Set `RUNNERS_HOME` to keep the runners somewhere else.

## Setup options

```sh
pnpm setup-runners --repo owner/repo --count 4   # or --org my-org
                   [--labels a,b]                 # extra labels (self-hosted, Windows, X64 are automatic)
                   [--name my-pc]                 # runner names: my-pc, my-pc-2, … (default: computer name)
                   [--dry-run]                    # show what would be created, change nothing
```

`--count` is the total you want. Existing runners are kept, so re-run it with a higher
count to add more. All runners in one folder must belong to the same repo or org.
New runners copy `.env` (runner environment settings) from an existing one.

To remove a runner, stop the dashboard and run, in that runner's folder:

```powershell
.\config.cmd remove --token (gh api -X POST repos/OWNER/REPO/actions/runners/remove-token --jq .token)
```

then delete the folder.

## Dashboard

```sh
pnpm start            # or: node dashboard/index.mjs
pnpm status           # what each runner is doing, from GitHub's API
pnpm watch            # the same, refreshed every 10s
```

For org-level runners, `status` and `watch` need `REPO=owner/repo` to know whose runs to show.

A handy alias: `alias runners='node ~/actions-runners/actions-runner-dashboard/dashboard/index.mjs'`.

| Key | Action |
| --- | --- |
| ↑/↓, 0-9, click | switch runner |
| wheel, a/z, PgUp/PgDn | scroll |
| b | jump to bottom |
| w | clear the view |
| r | restart a stopped runner |
| click a PR | open it in the browser |
| q, Ctrl+C | stop all runners cleanly (again to force) |

## Web dashboard

The same dashboard in the browser: the runner list, live colored logs (all runners or
one), clickable PR links, a restart button for stopped runners, and the usage stats.

```sh
cd web && pnpm install && cd ..   # once
pnpm web              # or: node dashboard/index.mjs --web
```

This runs the runners without the terminal UI (their output still goes to the console),
builds the web app on first run, serves it at <http://127.0.0.1:3130> and opens it in
your browser (`RUNNERS_WEB_OPEN=0` to skip that). Ctrl+C stops
every runner cleanly, as `q` does in the terminal dashboard.

The site runs as its own background process, so it stays up after the runners stop and
says they're offline, with who to ping (`NEXT_PUBLIC_RUNNERS_OWNER` in `web/.env.local`).

```sh
pnpm site             # just the site, in the foreground (e.g. to start it at logon)
pnpm site:stop        # stop the site, wherever it was started
```

After changing `web/`: `pnpm site:stop`, then `pnpm web:build`, then start it again.
Building while the site runs breaks the running site.

A handy alias: `alias runners-web='node ~/actions-runners/actions-runner-dashboard/dashboard/index.mjs --web'`.

- Only one of `runners` and `runners-web` can run at a time, since both run the runners.
  The terminal dashboard serves the same API, so `pnpm web:dev` works next to it while
  working on `web/`.
- Both servers listen on 127.0.0.1 only. To reach the dashboard from elsewhere, put a
  tunnel such as `cloudflared` in front of port 3130, **with access control** (for
  example Cloudflare Access): anyone who can open it sees your logs and can restart runners.

### Runner status on GitHub

When the runners are off, GitHub only says "Waiting for a runner to pick up this job…".
To say why, add this job to a workflow that uses them. It runs on GitHub's own runners,
reads `/api/status`, and warns on the run (with a link to the dashboard) when they're
offline or the machine is unreachable. It never fails the run.

```yaml
jobs:
  runner-status:
    uses: rinmeng/actions-runner-dashboard/.github/workflows/runner-status.yml@main
    # with:
    #   dashboard-url: https://services.web8th.com
    #   owner: Rin
```

| Setting | Default |
| --- | --- |
| `RUNNERS_WEB_PORT` | `3130`, the web dashboard |
| `RUNNERS_WEB_HOST` | `127.0.0.1` |
| `RUNNERS_API_PORT` | `7130`, the runners' API the web dashboard reads (127.0.0.1 only) |

Temperatures (and network speed) come from [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)
when it is running with its web server on (Options › Remote Web Server, port 8085).
Without it, GPU temperature falls back to `nvidia-smi`, network speed to Windows'
counters, and the CPU and SSD temperatures show `—`.

## How it works

- Each runner is started as `bin\Runner.Listener.exe run` with its own hidden console.
  `run.cmd` is not used: on Ctrl+C it asks "Terminate batch job (Y/N)?" and with no
  answer falls into its restart loop. Its exit-code handling (retry, self-update) is
  reproduced in `dashboard/runners.mjs`.
- To stop, a short PowerShell helper attaches to each runner's console and sends it
  Ctrl+C. Sending one to the shared console would also hit pnpm, which then kills
  the dashboard mid-shutdown.
- Who requested a job, and the PR, come from the job's `github` context in the
  runner's newest `_diag/Worker_*.log`, so no API calls are needed.
- Usage comes from Windows performance counters, sampled every 2 seconds by one
  long-running PowerShell process.
- The runners' process serves a small API on 127.0.0.1 (`dashboard/api.mjs`): a
  server-sent event stream of state and log lines, with colors already turned into
  styled segments, and a restart endpoint. The web app proxies it under `/api`, so a
  tunnel only needs the one port.

Not supported: macOS/Linux, and runners installed as a Windows service.

## License

MIT
