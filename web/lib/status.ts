import type { RunnerStatus } from "@/lib/types"

// Dot and text color per runner status, matching the terminal dashboard.
export const STATUS_STYLE: Record<RunnerStatus, { dot: string; text: string }> = {
  starting: { dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
  idle: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  busy: { dot: "bg-amber-500 animate-pulse", text: "text-amber-600 dark:text-amber-400" },
  reconnecting: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  restarting: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  stopping: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  stopped: { dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
  failed: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
}

// Each runner's color in the "All runners" view, as terminal palette indexes:
// the same order as the terminal dashboard (red, green, yellow, blue, …).
const RUNNER_COLORS = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14]
export const runnerColor = (position: number) =>
  `var(--ansi-${RUNNER_COLORS[position % RUNNER_COLORS.length]})`

export const canRestart = (status: RunnerStatus) =>
  status === "stopped" || status === "failed"
