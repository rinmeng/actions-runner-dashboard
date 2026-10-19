# actions-runner-dashboard

A terminal dashboard for running several self-hosted GitHub Actions runners on one
Windows machine. Plain Node, no dependencies.

- A sidebar with every runner's status (idle / busy / reconnecting / stopping) and
  its current or last job: `✓ @user Workflow`.
- Click a runner (or press its number) to see only its logs. `0` shows them all interleaved.
- Each job start is rewritten to say who asked for it, with a clickable PR link:
  `2026-10-19 21:39:59Z @user (PR #210) requested: Frontend CI › Lint, format & typecheck`
- Live CPU, RAM and GPU use for the whole machine and for the runners' own process
  trees, plus the max seen this session.
- `q` / Ctrl+C stops every runner cleanly, so each one ends its GitHub session.
  Force-killing a runner leaves the session behind and the next start fails with
  "A session for this runner already exists".

## Requirements

- Windows, Node 18+, Git Bash (or any terminal with mouse reporting; OSC 8 links are a bonus).
- Runners installed side by side as `actions-runner`, `actions-runner-2`, … and each
  configured with `config.cmd` (the dashboard reads their `.runner` files).
- [`gh`](https://cli.github.com/) for `runners.sh status` / `watch` only.

## Layout

Clone this repo next to the runner folders; that folder is where runners are looked for.
Set `RUNNERS_HOME` to look somewhere else.

```
~/
├── actions-runner/
├── actions-runner-2/
├── …
└── actions-runner-dashboard/   ← this repo
```

## Usage

```sh
pnpm start            # or: node dashboard/index.mjs
pnpm status           # what each runner is doing, from GitHub's API
pnpm watch            # the same, refreshed every 10s
```

A handy alias: `alias runners='node ~/actions-runner-dashboard/dashboard/index.mjs'`.

| Key | Action |
| --- | --- |
| ↑/↓, 0-9, click | switch runner |
| wheel, a/z, PgUp/PgDn | scroll |
| b | jump to bottom |
| w | clear the view |
| r | restart a stopped runner |
| click a PR | open it in the browser |
| q, Ctrl+C | stop all runners cleanly (again to force) |

## Adding a runner

Get a registration token and configure a new folder next to the others:

```sh
gh api -X POST repos/OWNER/REPO/actions/runners/registration-token --jq .token
```

```powershell
mkdir ~/actions-runner-9; cd ~/actions-runner-9
tar -xf ../actions-runner-win-x64-<version>.zip
.\config.cmd --unattended --url https://github.com/OWNER/REPO --token <token> --name <name>-9 --labels <label> --work _work
```

Restart the dashboard to pick it up.

## How it works

- Each runner is started as `bin\Runner.Listener.exe run` with its own hidden console.
  `run.cmd` is not used: on Ctrl+C it asks "Terminate batch job (Y/N)?" and with no
  answer falls into its restart loop. Its exit-code handling (retry, self-update) is
  reproduced in `dashboard/runners.mjs`.
- To stop, a short PowerShell helper attaches to each runner's console and sends it
  Ctrl+C. Sending one to the shared console would also hit pnpm, which then kills
  the dashboard mid-shutdown.
- Who requested a job comes from the job's `github` context in the runner's newest
  `_diag/Worker_*.log`, so no API calls are needed.
- Usage comes from Windows performance counters, sampled every 2 seconds by one
  long-running PowerShell process.
