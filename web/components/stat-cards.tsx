import { Cpu, Gauge, HardDrive, MemoryStick, Network, Thermometer } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { celsius, gigabytes, percent, specLines, speed } from "@/lib/format"
import type { DashboardState } from "@/lib/types"
import { cn } from "@/lib/utils"

const clamp = (value: number) => Math.min(100, Math.max(0, value))
const THIN_TRACK = "*:data-[slot=progress-track]:h-1.5"

// The machine's use, with the runners' own share as a second Progress laid over it
// (Progress takes one value): a transparent track and an amber indicator.
function UsageBar({ used, runners, label }: { used: number; runners?: number; label: string }) {
  return (
    <div className="relative">
      <Progress value={clamp(used)} aria-label={label} className={THIN_TRACK} />
      {runners !== undefined && (
        <Progress
          value={clamp(runners)}
          aria-label={`${label}, runners' share`}
          className={cn(
            "absolute inset-0",
            THIN_TRACK,
            "*:data-[slot=progress-track]:bg-transparent **:data-[slot=progress-indicator]:bg-amber-500"
          )}
        />
      )}
    </div>
  )
}

function StatCard({
  title,
  icon: Icon,
  hint,
  spec,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  hint?: string
  // The hardware, under the title: "AMD Ryzen 9 9900X · 12C/24T · 4.4 GHz base".
  spec?: string
  children: React.ReactNode
}) {
  return (
    <Card size="sm" className="gap-2">
      <CardHeader className="flex flex-col gap-0.5">
        <div className="flex w-full items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm">{title}</CardTitle>
          {hint && <span className="ml-auto text-xs text-muted-foreground">{hint}</span>}
        </div>
        {spec && (
          <Tooltip>
            <TooltipTrigger
              render={<p className="w-full cursor-default truncate text-left text-xs text-muted-foreground" />}
            >
              {spec}
            </TooltipTrigger>
            <TooltipContent>{spec}</TooltipContent>
          </Tooltip>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">{children}</CardContent>
    </Card>
  )
}

// CPU, RAM or GPU: the machine's use and the runners' share, now and the max this session.
function UsageCard({
  title,
  icon,
  hint,
  spec,
  used,
  runners,
  maxUsed,
  maxRunners,
  bar,
  format,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  hint?: string
  spec?: string
  used: number
  runners: number
  maxUsed?: number
  maxRunners?: number
  // Bar lengths in percent, when the values aren't percentages already.
  bar?: { used: number; runners: number }
  format: (value: number) => string
}) {
  return (
    <StatCard title={title} icon={icon} hint={hint} spec={spec}>
      <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
        <span className="font-heading text-2xl font-semibold tabular-nums">{format(used)}</span>
        <span className="text-xs text-muted-foreground">
          runners <span className="font-medium text-amber-600 tabular-nums dark:text-amber-400">{format(runners)}</span>
        </span>
      </div>
      <UsageBar label={`${title} use`} used={bar?.used ?? used} runners={bar?.runners ?? runners} />
      {maxUsed !== undefined && maxRunners !== undefined && (
        <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          Max {format(maxUsed)} · runners {format(maxRunners)}
        </p>
      )}
    </StatCard>
  )
}

// Readings with their current value and this session's lowest and highest.
function RangeCard({
  title,
  icon,
  rows,
  range,
  format,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  rows: { label: string; key: string; value: number | null }[]
  range: DashboardState["range"]
  format: (value: number | null | undefined) => string
}) {
  return (
    <StatCard title={title} icon={icon}>
      <Table className="text-xs tabular-nums">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-7 px-0" />
            <TableHead className="h-7 px-0 text-right font-normal text-muted-foreground">now</TableHead>
            <TableHead className="h-7 px-0 text-right font-normal text-muted-foreground">min</TableHead>
            <TableHead className="h-7 px-0 text-right font-normal text-muted-foreground">max</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ label, key, value }) => (
            <TableRow key={key} className="border-0">
              <TableCell className="px-0 py-1 text-muted-foreground">{label}</TableCell>
              <TableCell className="px-0 py-1 text-right text-sm font-medium">{format(value)}</TableCell>
              <TableCell className="px-0 py-1 text-right text-muted-foreground">{format(range[key]?.min)}</TableCell>
              <TableCell className="px-0 py-1 text-right text-muted-foreground">{format(range[key]?.max)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </StatCard>
  )
}

// A grid above the logs, one column beside them from xl up (see Dashboard).
export const STAT_GRID = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1"

export function StatCards({ state, className }: { state: DashboardState; className?: string }) {
  const { usage, peak, range } = state
  if (!usage) {
    return <p className={cn("text-sm text-muted-foreground", className)}>Sampling usage…</p>
  }
  const usedDisk = usage.disk.total - usage.disk.free
  const specs = specLines(state.specs)
  return (
    <div className={cn(STAT_GRID, className)}>
      <UsageCard
        title="CPU"
        icon={Cpu}
        hint={specs.cpu ? undefined : `${usage.threads} threads`}
        spec={specs.cpu}
        used={usage.cpu.used}
        runners={usage.cpu.runners}
        maxUsed={peak?.cpu.used}
        maxRunners={peak?.cpu.runners}
        format={percent}
      />
      <UsageCard
        title="RAM"
        icon={MemoryStick}
        hint={`of ${gigabytes(usage.ram.total)}`}
        spec={specs.ram}
        used={usage.ram.used}
        runners={usage.ram.runners}
        maxUsed={peak?.ram.used}
        maxRunners={peak?.ram.runners}
        bar={{
          used: (usage.ram.used / usage.ram.total) * 100,
          runners: (usage.ram.runners / usage.ram.total) * 100,
        }}
        format={gigabytes}
      />
      <UsageCard
        title="GPU"
        icon={Gauge}
        spec={specs.gpu}
        used={usage.gpu.used}
        runners={usage.gpu.runners}
        maxUsed={peak?.gpu.used}
        maxRunners={peak?.gpu.runners}
        format={percent}
      />
      <RangeCard
        title="Temperature"
        icon={Thermometer}
        range={range}
        format={celsius}
        rows={[
          { label: "CPU", key: "temp.cpu", value: usage.temp.cpu },
          { label: "GPU", key: "temp.gpu", value: usage.temp.gpu },
          { label: "Hot spot", key: "temp.gpuHotSpot", value: usage.temp.gpuHotSpot },
          { label: "SSD", key: "temp.ssd", value: usage.temp.ssd },
        ]}
      />
      <RangeCard
        title="Network"
        icon={Network}
        range={range}
        format={speed}
        rows={[
          { label: "↓ Down", key: "net.down", value: usage.net.down },
          { label: "↑ Up", key: "net.up", value: usage.net.up },
        ]}
      />
      <StatCard
        title={`Disk ${usage.disk.drive}`}
        icon={HardDrive}
        hint={`of ${gigabytes(usage.disk.total)}`}
        spec={specs.disk}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-heading text-2xl font-semibold tabular-nums">{gigabytes(usage.disk.free)}</span>
          <span className="text-xs text-muted-foreground">free</span>
        </div>
        <UsageBar label="Disk space used" used={(usedDisk / usage.disk.total) * 100} />
        <p className="flex justify-between gap-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          <span>{percent((usedDisk / usage.disk.total) * 100)} used</span>
          {usage.disk.read != null && (
            <span>
              Read {speed(usage.disk.read)} · Write {speed(usage.disk.write)}
            </span>
          )}
        </p>
      </StatCard>
    </div>
  )
}
