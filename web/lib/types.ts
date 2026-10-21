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

type Share = { used: number; runners: number }

export type Usage = {
  threads: number
  cpu: Share
  ram: Share & { total: number }
  gpu: Share
  disk: { drive: string; free: number; total: number }
  net: { down: number; up: number }
  temp: {
    cpu: number | null
    gpu: number | null
    gpuHotSpot: number | null
    ssd: number | null
  }
}

export type DashboardState = {
  uptime: number
  quitting: boolean
  usage: Usage | null
  peak: { cpu: Share; ram: Share; gpu: Share } | null
  // Lowest and highest this session, by "group.name" (e.g. "temp.cpu").
  range: Record<string, { min: number; max: number }>
  runners: Runner[]
}
