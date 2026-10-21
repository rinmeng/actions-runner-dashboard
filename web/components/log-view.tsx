"use client"

import * as React from "react"
import { ArrowDown } from "lucide-react"

import { AnsiText } from "@/components/ansi-text"
import { Button } from "@/components/ui/button"
import type { Line } from "@/lib/types"

// Lines drawn at once; older ones are still in the terminal dashboard.
const RENDER_LIMIT = 5000
// How close to the bottom (px) still counts as following the output.
const PIN_THRESHOLD = 48

export function LogView({
  lines,
  tagFor,
}: {
  lines: Line[]
  // In the "All runners" view, the runner's colored "[runner 2]" tag.
  tagFor?: (line: Line) => React.ReactNode
}) {
  const scroller = React.useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = React.useState(true)
  // Id of the newest line seen at the bottom; counted by id since old lines get dropped.
  const lastId = lines.at(-1)?.id ?? 0
  const [seenId, setSeenId] = React.useState(lastId)
  const shown = lines.length > RENDER_LIMIT ? lines.slice(-RENDER_LIMIT) : lines

  React.useLayoutEffect(() => {
    const element = scroller.current
    if (pinned && element) element.scrollTop = element.scrollHeight
  }, [lines, pinned])

  const onScroll = () => {
    const element = scroller.current
    if (!element) return
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < PIN_THRESHOLD
    setPinned(atBottom)
    if (atBottom) setSeenId(lastId)
  }

  const jumpToBottom = () => {
    setPinned(true)
    setSeenId(lastId)
  }

  let unseen = 0
  if (!pinned) {
    for (let index = lines.length - 1; index >= 0 && lines[index].id > seenId; index--) unseen++
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="absolute inset-0 overflow-auto py-3 font-mono text-[12.5px] leading-5"
      >
        {lines.length > RENDER_LIMIT && (
          <p className="px-4 pb-2 text-muted-foreground">
            Showing the last {RENDER_LIMIT.toLocaleString()} lines.
          </p>
        )}
        {shown.length === 0 && <p className="px-4 text-muted-foreground">No output yet.</p>}
        {shown.map((line) => (
          <div
            key={line.id}
            className="px-4 break-all whitespace-pre-wrap [contain-intrinsic-size:auto_1.25rem] [content-visibility:auto] hover:bg-muted/60"
          >
            {tagFor?.(line)}
            <AnsiText segments={line.segments} />
          </div>
        ))}
      </div>
      {!pinned && (
        <Button size="sm" variant="secondary" className="absolute right-6 bottom-4 shadow-md" onClick={jumpToBottom}>
          <ArrowDown data-icon="inline-start" />
          {unseen > 0 ? `${unseen.toLocaleString()} new` : "Latest"}
        </Button>
      )}
    </div>
  )
}
