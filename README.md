# actions-runner-dashboard

Set up and run several self-hosted GitHub Actions runners on one Windows machine,
watched from a terminal dashboard. Plain Node, no dependencies.

- **Setup:** one command downloads the runner (checksum-verified) and creates and
  registers as many runner folders as you want, for a repo or an org.
- **Dashboard:** a sidebar with every runner's status and its current or last job
  (`✓ @user Workflow`). Click a runner, or press its number, to see only its logs;
  `0` shows them all.
- **Who and which PR:** each job start shows who asked for it, with a clickable PR link:
  `2026-10-19 21:39:59Z @user (PR #210) requested: Frontend CI › Lint, format & typecheck`
- **Usage:** live CPU, RAM and GPU use for the whole machine and for the runners' own
  process trees, plus the max seen this session.
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

Not supported: macOS/Linux, and runners installed as a Windows service.

## License

MIT
