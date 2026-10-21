import type { Specs } from "@/lib/types"

const GB = 1024 ** 3

export const percent = (value: number) => `${Math.round(value)}%`
export const gigabytes = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`
export const celsius = (value: number | null | undefined) =>
  value == null ? "—" : `${Math.round(value)}°C`

// Bytes per second as "840 KB/s" or "2.4 MB/s".
export const speed = (bytes: number | null | undefined) =>
  bytes == null
    ? "—"
    : bytes < 1024 ** 2
      ? `${Math.round(bytes / 1024)} KB/s`
      : `${(bytes / 1024 ** 2).toFixed(1)} MB/s`

const MEMORY_TYPES: Record<number, string> = { 24: "DDR3", 26: "DDR4", 34: "DDR5" }
const ghz = (mhz: number) => `${(mhz / 1000).toFixed(1)} GHz`
// Joins the parts that are known; `x && "text"` parts drop out when x is missing.
const join = (...parts: unknown[]) => parts.filter(Boolean).join(" · ")

// One line per part for the stat cards, e.g. "AMD Ryzen 9 9900X · 12C/24T · 4.4 GHz base".
export function specLines(specs: Specs | null) {
  const { cpu, gpu, ram, disk } = specs ?? {}
  const type = ram?.type ? MEMORY_TYPES[ram.type] : undefined
  return {
    cpu: join(
      cpu?.name?.replace(/\s+\d+-Core Processor$/, ""),
      cpu?.cores && `${cpu.cores}C/${cpu.threads}T`,
      cpu?.baseMhz && `${ghz(cpu.baseMhz)} base`
    ),
    gpu: join(
      gpu?.name,
      gpu?.memoryMb && `${Math.round(gpu.memoryMb / 1024)} GB`,
      gpu?.maxMhz && `${ghz(gpu.maxMhz)} max`
    ),
    // The long part number last, where truncation cuts it rather than the speed.
    ram: join(
      [ram?.maker, ram?.sticks && ram.stickBytes && `${ram.sticks}×${Math.round(ram.stickBytes / 1024 ** 3)} GB`]
        .filter(Boolean)
        .join(" "),
      ram?.mts && `${type ? `${type}-` : ""}${ram.mts}`,
      ram?.part
    ),
    disk: join(disk?.name, disk?.bus),
  }
}

// "42s", or "3m 05s" past a minute, or "1h 03m" past an hour.
export function duration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

// "3d 04h 12m", dropping days while under a day.
export function uptimeText(seconds: number) {
  const days = Math.floor(seconds / 86400)
  const hours = String(Math.floor((seconds % 86400) / 3600)).padStart(2, "0")
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")
  return days ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`
}
