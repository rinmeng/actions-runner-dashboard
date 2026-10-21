import { Cpu, Gauge, HardDrive, MemoryStick, Network, Thermometer } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { celsius, gigabytes, percent, speed } from "@/lib/format"
import type { DashboardState } from "@/lib/types"
import { cn } from "@/lib/utils"

// A bar of the machine's use, with the runners' own share drawn over it.
function UsageBar({ used, runners }: { used: number; runners?: number }) {
  const clamp = (value: number) => `${Math.min(100, Math.max(0, value))}%`
  return (
    <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/40" style={{ width: clamp(used) }} />
      {runners !== undefined && (
        <div className="absolute inset-y-0 left-0 rounded-full bg-amber-500" style={{ width: clamp(runners) }} />
      )}
    </div>
  )
}

function StatCard({
  title,
  icon: Icon,
  hint,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  hint?: string
  children: React.ReactNode
}) {
  return (
    <Card size="sm" className="gap-2">
      <CardHeader className="flex flex-row items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <CardTitle className="text-sm">{title}</CardTitle>
        {hint && <span className="ml-auto text-xs text-muted-foreground">{hint}</span>}
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
  used: number
  runners: number
  maxUsed?: number
  maxRunners?: number
  // Bar lengths in percent, when the values aren't percentages already.
  bar?: { used: number; runners: number }
  format: (value: number) => string
}) {
  return (
    <StatCard title={title} icon={icon} hint={hint}>
      <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
        <span className="font-heading text-2xl font-semibold tabular-nums">{format(used)}</span>
        <span className="text-xs text-muted-foreground">
          runners <span className="font-medium text-amber-600 tabular-nums dark:text-amber-400">{format(runners)}</span>
        </span>
      </div>
      <UsageBar used={bar?.used ?? used} runners={bar?.runners ?? runners} />
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
      <table className="w-full text-xs whitespace-nowrap tabular-nums">
        <thead className="text-muted-foreground">
          <tr>
            <th className="pb-1 text-left font-normal" />
            <th className="pb-1 text-right font-normal">now</th>
            <th className="pb-1 text-right font-normal">min</th>
            <th className="pb-1 text-right font-normal">max</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, key, value }) => (
            <tr key={key}>
              <td className="py-0.5 text-muted-foreground">{label}</td>
              <td className="py-0.5 text-right text-sm font-medium">{format(value)}</td>
              <td className="py-0.5 text-right text-muted-foreground">{format(range[key]?.min)}</td>
              <td className="py-0.5 text-right text-muted-foreground">{format(range[key]?.max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  return (
    <div className={cn(STAT_GRID, className)}>
      <UsageCard
        title="CPU"
        icon={Cpu}
        hint={`${usage.threads} threads`}
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
      <StatCard title={`Disk ${usage.disk.drive}`} icon={HardDrive} hint={`of ${gigabytes(usage.disk.total)}`}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-heading text-2xl font-semibold tabular-nums">{gigabytes(usage.disk.free)}</span>
          <span className="text-xs text-muted-foreground">free</span>
        </div>
        <UsageBar used={(usedDisk / usage.disk.total) * 100} />
        <p className="text-xs text-muted-foreground tabular-nums">{percent((usedDisk / usage.disk.total) * 100)} used</p>
      </StatCard>
    </div>
  )
}
