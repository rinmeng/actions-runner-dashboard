import { Cpu, Fan, Gauge, HardDrive, MemoryStick, Network, Thermometer } from "lucide-react"

import { AnimatedNumber } from "@/components/animated-number"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { celsius, clock, gigabytes, percent, rpm, specLines, speed } from "@/lib/format"
import { runnerColor } from "@/lib/status"
import type { DashboardState, Runner, Usage } from "@/lib/types"
import { cn } from "@/lib/utils"

// A card's live readings for its title row: the clock as a badge with a pulsing dot, then
// the fan, leaving out the ones there is no sensor for.
function Readings({ mhz, fan }: { mhz?: number | null; fan?: number | null }) {
  return (
    <>
      {mhz != null && (
        <Badge variant="outline" className="gap-1.5 tabular-nums" aria-label={`Clock ${clock(mhz)}`}>
          <span className="relative flex size-1.5" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
          </span>
          <span className="font-semibold text-foreground">{clock(mhz)}</span>
          <span className="font-normal text-muted-foreground">clock</span>
        </Badge>
      )}
      {fan != null && (
        <>
          <Fan className="ml-1 size-3" aria-label="Fan" />
          {rpm(fan)}
        </>
      )}
    </>
  )
}

const clamp = (value: number) => Math.min(100, Math.max(0, value))
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

type Share = Usage["cpu"]

type Segment = { key: string; label: string; value: number; color: string }

// The machine's use as one stacked bar: each runner's share in its color from the logs
// (or the runners' total in amber, from an API without the split), then everything else.
function UsageBar({ used, segments = [], label }: { used: number; segments?: Segment[]; label: string }) {
  // Each segment's width, cut short so the stack never runs past the machine's total.
  const widths = segments.reduce<number[]>(
    (done, segment) => [...done, Math.min(clamp(used) - sum(done), Math.max(0, segment.value))],
    []
  )
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamp(used))}
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      {segments.map((segment, index) => (
        <div
          key={segment.key}
          title={segment.label}
          className="h-full transition-all"
          style={{ width: `${widths[index]}%`, backgroundColor: segment.color }}
        />
      ))}
      <div className="h-full bg-primary transition-all" style={{ width: `${clamp(used) - sum(widths)}%` }} />
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
  hint?: React.ReactNode
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
          {hint && (
            <span className="ml-auto flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {hint}
            </span>
          )}
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
  share,
  runnerList,
  maxUsed,
  maxRunners,
  toPercent = (value) => value,
  format,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  hint?: React.ReactNode
  spec?: string
  share: Share
  runnerList: Runner[]
  maxUsed?: number
  maxRunners?: number
  // Bar lengths in percent, when the values aren't percentages already.
  toPercent?: (value: number) => number
  format: (value: number) => string
}) {
  const { used, runners, byRunner } = share
  const segments: Segment[] = byRunner
    ? runnerList.map((runner, position) => ({
        key: String(runner.number),
        label: `${runner.label}: ${format(byRunner[position] ?? 0)}`,
        value: toPercent(byRunner[position] ?? 0),
        color: runnerColor(position),
      }))
    : [{ key: "runners", label: `runners: ${format(runners)}`, value: toPercent(runners), color: "var(--color-amber-500)" }]
  return (
    <StatCard title={title} icon={icon} hint={hint} spec={spec}>
      <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
        <AnimatedNumber className="font-heading text-2xl font-semibold" value={used} format={format} />
        <span className="text-xs text-muted-foreground">
          runners <span className="font-medium text-amber-600 tabular-nums dark:text-amber-400">{format(runners)}</span>
        </span>
      </div>
      <UsageBar label={`${title} use`} used={toPercent(used)} segments={segments} />
      {maxUsed !== undefined && maxRunners !== undefined && (
        // Peaks this session, each with a dot in its color from the bar and the line above.
        <div className="flex items-center gap-3 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          <span className="font-medium tracking-wide uppercase">Max</span>
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            all
            <span className="font-semibold text-foreground">{format(maxUsed)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
            runners
            <span className="font-semibold text-amber-600 dark:text-amber-400">{format(maxRunners)}</span>
          </span>
        </div>
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

// A grid above the logs (see Dashboard): two cards per row from sm up, three from lg.
export const STAT_GRID = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"

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
        hint={
          usage.clock?.cpu != null || usage.fan?.cpu != null ? (
            <Readings mhz={usage.clock?.cpu} fan={usage.fan?.cpu} />
          ) : specs.cpu ? undefined : (
            `${usage.threads} threads`
          )
        }
        spec={specs.cpu}
        share={usage.cpu}
        runnerList={state.runners}
        maxUsed={peak?.cpu.used}
        maxRunners={peak?.cpu.runners}
        format={percent}
      />
      <UsageCard
        title="RAM"
        icon={MemoryStick}
        hint={[state.specs?.ram?.mts && `${state.specs.ram.mts} MT/s`, `of ${gigabytes(usage.ram.total)}`]
          .filter(Boolean)
          .join(" · ")}
        spec={specs.ram}
        share={usage.ram}
        runnerList={state.runners}
        maxUsed={peak?.ram.used}
        maxRunners={peak?.ram.runners}
        toPercent={(bytes) => (bytes / usage.ram.total) * 100}
        format={gigabytes}
      />
      <UsageCard
        title="GPU"
        icon={Gauge}
        hint={<Readings mhz={usage.clock?.gpu} fan={usage.fan?.gpu} />}
        spec={specs.gpu}
        share={usage.gpu}
        runnerList={state.runners}
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
          { label: "RAM", key: "temp.ram", value: usage.temp.ram ?? null },
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
          <AnimatedNumber className="font-heading text-2xl font-semibold" value={usage.disk.free} format={gigabytes} />
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
