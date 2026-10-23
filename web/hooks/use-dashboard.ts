"use client"

import * as React from "react"

import type { DashboardState, Line } from "@/lib/types"

// Lines kept in the browser across all runners; older ones are dropped.
const MAX_LINES = 20_000
const RETRY_MS = 3000

export type Connection = "connecting" | "open" | "closed"

// Live state and logs from /api/events. Lines arriving in a burst are applied
// once per frame rather than one render each.
export function useDashboard() {
  const [state, setState] = React.useState<DashboardState | null>(null)
  const [lines, setLines] = React.useState<Line[]>([])
  const [connection, setConnection] = React.useState<Connection>("connecting")

  React.useEffect(() => {
    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let frame = 0
    let pending: Line[] = []
    let updates = new Map<number, Line>()

    const flush = () => {
      frame = 0
      const added = pending
      const changed = updates
      pending = []
      updates = new Map()
      setLines((current) => {
        let next = changed.size
          ? current.map((line) => changed.get(line.id) ?? line)
          : current
        if (added.length) next = [...next, ...added]
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
      })
    }
    const schedule = () => {
      frame ||= requestAnimationFrame(flush)
    }

    const connect = () => {
      setConnection("connecting")
      source = new EventSource("/api/events")
      source.onopen = () => setConnection("open")
      source.addEventListener("snapshot", (event) => {
        const { lines: snapshotLines, ...snapshot } = JSON.parse(event.data)
        pending = []
        updates = new Map()
        setState(snapshot)
        setLines(snapshotLines)
      })
      source.addEventListener("state", (event) =>
        setState(JSON.parse(event.data))
      )
      source.addEventListener("line", (event) => {
        pending.push(JSON.parse(event.data))
        schedule()
      })
      source.addEventListener("line-update", (event) => {
        const line: Line = JSON.parse(event.data)
        const queued = pending.findIndex(
          (candidate) => candidate.id === line.id
        )
        if (queued !== -1) pending[queued] = line
        else updates.set(line.id, line)
        schedule()
      })
      source.onerror = () => {
        // EventSource retries dropped connections itself, but gives up on an
        // error response (the supervisor isn't running), so retry that here.
        if (source?.readyState === EventSource.CLOSED) {
          setConnection("closed")
          retry = setTimeout(connect, RETRY_MS)
        } else {
          setConnection("connecting")
        }
      }
    }

    connect()
    return () => {
      source?.close()
      clearTimeout(retry)
      cancelAnimationFrame(frame)
    }
  }, [])

  return { state, lines, connection }
}
