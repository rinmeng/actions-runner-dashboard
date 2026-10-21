"use client"

import { Clock, Layers, Server } from "lucide-react"

import { JobSummary } from "@/components/job-summary"
import { Badge } from "@/components/ui/badge"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import type { Connection } from "@/hooks/use-dashboard"
import { uptimeText } from "@/lib/format"
import { STATUS_STYLE } from "@/lib/status"
import type { DashboardState } from "@/lib/types"
import { cn } from "@/lib/utils"

const CONNECTION_STYLE: Record<Connection, { dot: string; label: string }> = {
  open: { dot: "bg-emerald-500", label: "Live" },
  connecting: { dot: "bg-amber-500 animate-pulse", label: "Connecting…" },
  closed: { dot: "bg-red-500", label: "Runners offline" },
}

export function RunnerSidebar({
  state,
  connection,
  selected,
  onSelect,
  now,
}: {
  state: DashboardState | null
  connection: Connection
  // 0 for all runners, else a runner's number.
  selected: number
  onSelect: (view: number) => void
  now: number
}) {
  const runners = state?.runners ?? []
  const count = (status: string) => runners.filter((runner) => runner.status === status).length

  return (
    <Sidebar>
      <SidebarHeader className="gap-1 px-4 pt-4">
        <div className="flex items-center gap-2">
          <Server className="size-4" />
          <span className="font-heading text-sm font-semibold">Actions runners</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {count("busy")} busy · {count("idle")} idle · {runners.length} total
        </p>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={selected === 0} onClick={() => onSelect(0)}>
                  <Layers />
                  <span>All runners</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Runners</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {runners.map((runner) => {
                const style = STATUS_STYLE[runner.status]
                return (
                  <SidebarMenuItem key={runner.number}>
                    <SidebarMenuButton
                      size="lg"
                      isActive={selected === runner.number}
                      onClick={() => onSelect(runner.number)}
                      className="h-auto flex-col items-stretch gap-1 py-2"
                    >
                      <span className="flex items-center gap-2">
                        <span className={cn("size-2 shrink-0 rounded-full", style.dot)} />
                        <span className="font-medium">{runner.label}</span>
                        <span className={cn("ml-auto text-xs", style.text)}>{runner.status}</span>
                      </span>
                      <JobSummary runner={runner} now={now} compact className="pl-4 text-xs" />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-1.5 px-4 pb-4 text-xs text-muted-foreground">
        {state && (
          <span className="flex items-center gap-2">
            <Clock className="size-3.5" />
            PC uptime <span className="ml-auto font-medium text-foreground tabular-nums">{uptimeText(state.uptime)}</span>
          </span>
        )}
        <Badge variant="outline" className="text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", CONNECTION_STYLE[connection].dot)} />
          {CONNECTION_STYLE[connection].label}
        </Badge>
      </SidebarFooter>
    </Sidebar>
  )
}
