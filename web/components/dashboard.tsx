"use client"

import * as React from "react"
import { Moon, PowerOff, RotateCw, Sun, TriangleAlert } from "lucide-react"
import { useTheme } from "next-themes"
import { toast } from "sonner"

import { JobSummary } from "@/components/job-summary"
import { LogView } from "@/components/log-view"
import { RunnerSidebar } from "@/components/runner-sidebar"
import { STAT_GRID, StatCards } from "@/components/stat-cards"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { useDashboard } from "@/hooks/use-dashboard"
import { useNow } from "@/hooks/use-now"
import { canRestart, runnerColor, STATUS_STYLE } from "@/lib/status"
import type { Line, Runner } from "@/lib/types"
import { cn } from "@/lib/utils"

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  )
}

async function restartRunner(runner: Runner) {
  const response = await fetch(`/api/runners/${runner.number}/restart`, { method: "POST" })
  const body = await response.json().catch(() => ({}))
  if (response.ok) toast.success(`Restarting ${runner.label}`)
  else toast.error(body.error ?? `Couldn't restart ${runner.label}`)
}

// Who to ask when the runners are off, e.g. "Rin" (set in web/.env.local).
const OWNER = process.env.NEXT_PUBLIC_RUNNERS_OWNER || "the owner"

function Offline() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="max-w-md items-center gap-3 px-8 py-10 text-center">
        <PowerOff className="size-8 text-muted-foreground" />
        <h2 className="font-heading text-lg font-semibold">
          {OWNER === "the owner" ? "The runners are offline" : `${OWNER}'s runners are offline`}
        </h2>
        <p className="text-sm text-muted-foreground">
          Jobs for these runners wait in GitHub&apos;s queue until they&apos;re back. Ping {OWNER} to turn them on.
        </p>
        <p className="text-xs text-muted-foreground">This page reconnects on its own once they&apos;re up.</p>
      </Card>
    </div>
  )
}

export function Dashboard() {
  const dashboard = useDashboard()
  const { lines, connection } = dashboard
  // Last state is stale once the runners are gone.
  const state = connection === "closed" ? null : dashboard.state
  const now = useNow()
  // 0 for all runners, else a runner's number.
  const [selected, setSelected] = React.useState(0)

  const runners = React.useMemo(() => state?.runners ?? [], [state])
  const runner = runners.find((candidate) => candidate.number === selected) ?? null
  const viewLines = React.useMemo(
    () => (selected === 0 ? lines : lines.filter((line) => line.runner === selected)),
    [lines, selected]
  )

  const positions = React.useMemo(
    () => new Map(runners.map((candidate, index) => [candidate.number, index])),
    [runners]
  )
  const tagFor = React.useCallback(
    (line: Line) => (
      <span style={{ color: runnerColor(positions.get(line.runner) ?? 0) }}>[runner {line.runner}] </span>
    ),
    [positions]
  )

  return (
    <SidebarProvider style={{ "--sidebar-width": "19rem" } as React.CSSProperties}>
      <RunnerSidebar
        state={state}
        connection={connection}
        selected={selected}
        onSelect={setSelected}
        now={now}
      />
      <SidebarInset className="h-svh min-w-0">
        <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <h1 className="font-heading text-base font-semibold">{runner ? runner.label : "All runners"}</h1>
              {runner && (
                <Badge variant="outline" className={STATUS_STYLE[runner.status].text}>
                  <span className={cn("size-1.5 rounded-full", STATUS_STYLE[runner.status].dot)} />
                  {runner.status}
                </Badge>
              )}
              {runner && <span className="truncate text-xs text-muted-foreground">{runner.name}</span>}
            </div>
            {runner ? (
              <JobSummary runner={runner} now={now} className="text-xs" />
            ) : (
              <p className="text-xs text-muted-foreground">Every runner&apos;s output as it happens. Pick one on the left to see only its logs.</p>
            )}
          </div>
          {runner && canRestart(runner.status) && (
            <Button size="sm" onClick={() => restartRunner(runner)}>
              <RotateCw data-icon="inline-start" />
              Restart
            </Button>
          )}
          <ThemeToggle />
        </header>

        {state?.quitting && (
          <div className="flex items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlert className="size-4" />
            Stopping: waiting for each runner to end its GitHub session.
          </div>
        )}

        {connection === "closed" ? (
          <Offline />
        ) : (
        /* Stats above the logs, or in a column beside them on wide screens. */
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 xl:flex-row-reverse xl:overflow-hidden">
          <div className="shrink-0 xl:w-80 xl:overflow-y-auto">
            {state ? (
              <StatCards state={state} />
            ) : (
              <div className={STAT_GRID}>
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="h-32 rounded-4xl" />
                ))}
              </div>
            )}
          </div>
          <Card className="min-h-96 min-w-0 flex-1 gap-0 py-0">
            <LogView key={selected} lines={viewLines} tagFor={selected === 0 ? tagFor : undefined} />
          </Card>
        </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
