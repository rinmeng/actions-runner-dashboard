#!/usr/bin/env bash
# Show what each runner is doing, from GitHub's side. Needs `gh` (signed in).
#   runners.sh status   each runner's state, current job and PR, and the queue
#   runners.sh watch    the same, refreshed every 10s
# The runners themselves are started with the dashboard: `pnpm start`.
set -u

# Runner installs (actions-runner, actions-runner-2, …) in RUNNERS_HOME, or by default
# the folder this repo is cloned into. Only the first one's .runner is read.
RUNNERS_HOME=${RUNNERS_HOME:-$(cd "$(dirname "$0")/.." && pwd)}
CONFIG=$(command ls -d "$RUNNERS_HOME"/actions-runner{,-[0-9]*}/.runner 2>/dev/null | head -1)
if [ -z "$CONFIG" ]; then
  echo "No configured runners found in $RUNNERS_HOME (set RUNNERS_HOME)." >&2
  exit 1
fi
# "owner/repo" for repo-level runners, "org" for org-level ones.
SCOPE=$(sed -n 's|.*"gitHubUrl": "https://[^/]*/\([^"]*\)".*|\1|p' "$CONFIG")
if [[ $SCOPE == */* ]]; then
  RUNNERS_API="repos/$SCOPE/actions/runners"
  REPO=${REPO:-$SCOPE}
else
  RUNNERS_API="orgs/$SCOPE/actions/runners"
  if [ -z "${REPO:-}" ]; then
    echo "These are org-level runners for $SCOPE. Set REPO=owner/repo to choose whose runs to show." >&2
    exit 1
  fi
fi

# OSC 8 terminal hyperlink: link URL TEXT
link() { printf '\e]8;;%s\e\\%s\e]8;;\e\\' "$1" "$2"; }

status() {
  declare -A job_name job_url job_pr
  local id run_label pr title branch runner name url pr_text

  while IFS=$'\t' read -r id pr title branch; do
    [ -z "$id" ] && continue
    if [ -n "$pr" ]; then
      pr_text=$(link "https://github.com/$REPO/pull/$pr" "#$pr $title")
    else
      pr_text="$branch"
    fi
    while IFS=$'\t' read -r runner name url; do
      [ -z "$runner" ] && continue
      job_name[$runner]=$name
      job_url[$runner]=$url
      job_pr[$runner]=$pr_text
    done < <(gh api "repos/$REPO/actions/runs/$id/jobs" \
      --jq '.jobs[] | select(.status == "in_progress" and .runner_name != null) | [.runner_name, .name, .html_url] | @tsv')
  done < <(gh api "repos/$REPO/actions/runs?status=in_progress&per_page=50" \
    --jq '.workflow_runs[] | [.id, (.pull_requests[0].number // ""), .display_title, .head_branch] | @tsv')

  printf '\e[1m%-32s %-8s %s\e[0m\n' RUNNER STATE "JOB / PR"
  while IFS=$'\t' read -r runner state busy; do
    if [ "$state" != online ]; then
      printf '%-32s \e[90m%-8s\e[0m\n' "$runner" offline
    elif [ -n "${job_name[$runner]:-}" ]; then
      printf '%-32s \e[33m%-8s\e[0m %s  %s\n' "$runner" busy \
        "$(link "${job_url[$runner]}" "${job_name[$runner]}")" "${job_pr[$runner]}"
    elif [ "$busy" = true ]; then
      printf '%-32s \e[33m%-8s\e[0m (starting job...)\n' "$runner" busy
    else
      printf '%-32s \e[32m%-8s\e[0m\n' "$runner" idle
    fi
  done < <(gh api "$RUNNERS_API" \
    --jq '.runners | sort_by(.name)[] | [.name, .status, (.busy | tostring)] | @tsv')

  local queued
  queued=$(gh api "repos/$REPO/actions/runs?status=queued&per_page=100" --jq '.total_count')
  printf '\nQueued runs: %s\n' "$queued"
}

case "${1:-status}" in
  status) status ;;
  watch) while true; do out=$(status); clear; date '+%T'; echo "$out"; sleep 10; done ;;
  *) echo "usage: $0 [status|watch]" >&2; exit 1 ;;
esac
