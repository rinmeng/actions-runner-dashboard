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
