#!/usr/bin/env bash
# Run all local GitHub Actions runners in one console, or show what each is working on.
#   runners.sh          start all runners; Ctrl+C stops them all
#   runners.sh status   show each runner's current job and PR
#   runners.sh watch    refresh status every 10s
set -u

# Runner installs (actions-runner, actions-runner-2, …) in RUNNERS_HOME, or by default
# the folder this repo is cloned into. All of them must be registered to the same repo.
RUNNERS_HOME=${RUNNERS_HOME:-$(cd "$(dirname "$0")/.." && pwd)}
DIRS=()
for dir in $(command ls -d "$RUNNERS_HOME"/actions-runner "$RUNNERS_HOME"/actions-runner-[0-9]* 2>/dev/null | sort -V); do
  [ -f "$dir/.runner" ] && DIRS+=("$dir")
done
if [ ${#DIRS[@]} -eq 0 ]; then
  echo "No configured runners found in $RUNNERS_HOME (set RUNNERS_HOME)." >&2
  exit 1
fi
REPO=$(sed -n 's|.*"gitHubUrl": "https://github.com/\([^"]*\)".*|\1|p' "${DIRS[0]}/.runner")
COLORS=(31 32 33 34 35 36 91 92 93 94 95 96)

# OSC 8 terminal hyperlink: link URL TEXT
link() { printf '\e]8;;%s\e\\%s\e]8;;\e\\' "$1" "$2"; }

# Print "actor<TAB>event<TAB>pr<TAB>workflow" from the github context in a Worker log.
job_context() {
  awk '
    /"k": "/ { match($0, /"k": "[^"]+"/); k = substr($0, RSTART + 6, RLENGTH - 7); next }
    k != "" && /"v": / {
      if (!(k in val)) { v = $0; sub(/.*"v": /, "", v); gsub(/^"|"?,?$/, "", v); val[k] = v }
      k = ""
    }
    END { print val["triggering_actor"] "\t" val["event_name"] "\t" val["number"] + 0 "\t" val["workflow"] }' "$1"
}

# Prefix each line with TAG and expand "Running job: X" into who requested it and for which PR.
decorate() {
  local tag=$1 diag=$2/_diag line ts job prev log i actor event pr workflow who
  # Keep reading through Ctrl+C so the listener can still log its shutdown into an open pipe.
  trap '' INT
  while IFS= read -r line; do
    line=${line%$'\r'}
    if [[ $line =~ ^(.*Z):\ Running\ job:\ (.*)$ ]]; then
      ts=${BASH_REMATCH[1]} job=${BASH_REMATCH[2]}
      prev=$(command ls -t "$diag"/Worker_*.log 2>/dev/null | head -1)
      # The listener prints this before the worker has written its log; wait up to 10s for it.
      for i in {1..20}; do
        log=$(command ls -t "$diag"/Worker_*.log 2>/dev/null | head -1)
        if [ "$log" != "$prev" ] && grep -q '"triggering_actor"' "$log" 2>/dev/null; then break; fi
        log=; sleep 0.5
      done
      if [ -n "$log" ]; then
        IFS=$'\t' read -r actor event pr workflow < <(job_context "$log")
        who=$'\e[1m@'$actor$'\e[0m'
        if [ "$event" = pull_request ] && [ "$pr" != 0 ]; then
          who+=" ($(link "https://github.com/$REPO/pull/$pr" "PR #$pr"))"
        else
          who+=" ($event)"
        fi
        line="$ts $who requested: $workflow › "$'\e[1m'$job$'\e[0m'
      fi
    fi
    printf '%s%s\n' "$tag" "$line"
  done
}

listener_count() {
  tasklist //FI "IMAGENAME eq Runner.Listener.exe" //NH 2>/dev/null | grep -c Runner.Listener
}

stop_all() {
  trap - INT TERM EXIT
  local i n
  # Ctrl+C also reaches each listener, which then deletes its GitHub session. Force-killing it
  # first leaves the session behind and the next start fails with "session already exists".
  echo "Stopping runners, waiting for them to end their GitHub sessions..."
  for i in {1..30}; do
    n=$(listener_count)
    [ "$n" -eq 0 ] && break
    printf '\r  %d still running (%ds)' "$n" "$i"
    sleep 1
  done
  echo
  if [ "$(listener_count)" -gt 0 ]; then
    echo "Timed out, force-killing the rest (their sessions will expire on GitHub's side)."
    taskkill //F //IM Runner.Worker.exe >/dev/null 2>&1
    taskkill //F //IM Runner.Listener.exe >/dev/null 2>&1
  fi
  kill $(jobs -p) 2>/dev/null
  wait 2>/dev/null
  echo "All runners stopped."
}

start_all() {
  if [ "$(listener_count)" -gt 0 ]; then
    echo "Runners are already running (or still shutting down). Wait for them to exit first." >&2
    exit 1
  fi
  trap stop_all INT TERM EXIT
  for i in "${!DIRS[@]}"; do
    local tag
    tag=$(printf '\e[%sm[runner %d]\e[0m ' "${COLORS[$((i % ${#COLORS[@]}))]}" $((i + 1)))
    ( cd "${DIRS[$i]}" && ./run.cmd 2>&1 | decorate "$tag" "${DIRS[$i]}" ) &
  done
  wait
}

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
  done < <(gh api "repos/$REPO/actions/runners" \
    --jq '.runners | sort_by(.name)[] | [.name, .status, (.busy | tostring)] | @tsv')

  local queued
  queued=$(gh api "repos/$REPO/actions/runs?status=queued&per_page=100" --jq '.total_count')
  printf '\nQueued runs: %s\n' "$queued"
}

case "${1:-start}" in
  start) start_all ;;
  status) status ;;
  watch) while true; do out=$(status); clear; date '+%T'; echo "$out"; sleep 10; done ;;
  *) echo "usage: $0 [start|status|watch]" >&2; exit 1 ;;
esac
