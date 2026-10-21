// What the supervisor's API sends (dashboard/api.mjs).

export type Segment = {
  text: string
  // 0-15 for the terminal palette (--ansi-N), or "#rrggbb".
  fg?: number | string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  url?: string
}

export type Line = {
  id: number
  at: number
  runner: number
  segments: Segment[]
}

export type Job = {
  name: string | null
  workflow: string | null
  actor: string | null
  event: string | null
  pr: number | null
  repoUrl: string | null
  startedAt: number | null
  finishedAt: number | null
  result: string | null
}

export type RunnerStatus =
  | "starting"
  | "idle"
  | "busy"
  | "reconnecting"
  | "restarting"
  | "stopping"
  | "stopped"
  | "failed"

export type Runner = {
  number: number
  label: string
  name: string
  status: RunnerStatus
  job: Job | null
  last: Job | null
}

type Peak = { used: number; runners: number }
// Each runner's share, in the order of `runners`.
type Share = Peak & { byRunner?: number[] }

export type Usage = {
  threads: number
  cpu: Share
  ram: Share & { total: number }
  gpu: Share
  // Read and write rates in bytes per second; null without LibreHardwareMonitor.
  disk: { drive: string; free: number; total: number; read: number | null; write: number | null }
  net: { down: number; up: number }
  // MHz and RPM; null without LibreHardwareMonitor or a sensor for it. Older APIs leave them out.
  clock?: { cpu: number | null; gpu: number | null }
  fan?: { cpu: number | null; gpu: number | null }
  temp: {
    cpu: number | null
    gpu: number | null
    gpuHotSpot: number | null
    ssd: number | null
    // Older APIs leave it out.
    ram?: number | null
  }
}

// The machine's hardware, as Windows reports it (dashboard/usage.mjs readSpecs).
export type Specs = {
  cpu?: { name?: string; cores?: number; threads?: number; baseMhz?: number }
  gpu?: { name?: string; memoryMb?: number; maxMhz?: number }
  ram?: {
    part?: string
    maker?: string
    sticks?: number
    stickBytes?: number
    mts?: number
    // SMBIOS memory type: 26 is DDR4, 34 is DDR5.
    type?: number
  }
  disk?: { name?: string; bus?: string }
}

export type DashboardState = {
  uptime: number
  quitting: boolean
  usage: Usage | null
  peak: { cpu: Peak; ram: Peak; gpu: Peak } | null
  // Lowest and highest this session, by "group.name" (e.g. "temp.cpu").
  range: Record<string, { min: number; max: number }>
  specs: Specs | null
  runners: Runner[]
}
