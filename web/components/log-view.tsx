"use client"

import * as React from "react"
import { ArrowDown, SquareTerminal, WrapText } from "lucide-react"

import { AnimatedNumber } from "@/components/animated-number"
import { AnsiText } from "@/components/ansi-text"
import { Button } from "@/components/ui/button"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block"
import type { Line } from "@/lib/types"
import { cn } from "@/lib/utils"

// Lines drawn at once; older ones are still in the terminal dashboard.
const RENDER_LIMIT = 5000
// How close to the bottom (px) still counts as following the output.
const PIN_THRESHOLD = 48

const plainText = (line: Line) =>
  line.segments.map((segment) => segment.text).join("")

export function LogView({
  title,
  lines,
  tagFor,
  className,
}: {
  title: string
  lines: Line[]
  // In the "All runners" view, the runner's colored "[runner 2]" tag.
  tagFor?: (line: Line) => React.ReactNode
  className?: string
}) {
  const scroller = React.useRef<HTMLPreElement>(null)
  const [pinned, setPinned] = React.useState(true)
  const [wrap, setWrap] = React.useState(true)
  // Id of the newest line seen at the bottom; counted by id since old lines get dropped.
  const lastId = lines.at(-1)?.id ?? 0
  const lastIdRef = React.useRef(lastId)
  const [seenId, setSeenId] = React.useState(lastId)
  const shown = lines.length > RENDER_LIMIT ? lines.slice(-RENDER_LIMIT) : lines

  React.useEffect(() => {
    lastIdRef.current = lastId
  }, [lastId])

  React.useLayoutEffect(() => {
    const element = scroller.current
    if (pinned && element) element.scrollTop = element.scrollHeight
  }, [lines, pinned, wrap])

  React.useEffect(() => {
    const element = scroller.current
    if (!element) return
    const onScroll = () => {
      const atBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight <
        PIN_THRESHOLD
      setPinned(atBottom)
      if (atBottom) setSeenId(lastIdRef.current)
    }
    element.addEventListener("scroll", onScroll, { passive: true })
    return () => element.removeEventListener("scroll", onScroll)
  }, [])

  const jumpToBottom = () => {
    setPinned(true)
    setSeenId(lastId)
  }

  let unseen = 0
  if (!pinned) {
    for (
      let index = lines.length - 1;
      index >= 0 && lines[index].id > seenId;
      index--
    )
      unseen++
  }

  // Built only when copying: thousands of lines.
  const [copyText, setCopyText] = React.useState("")
  const prepareCopy = () =>
    setCopyText(
      shown
        .map(
          (line) => (tagFor ? `[runner ${line.runner}] ` : "") + plainText(line)
        )
        .join("\n")
    )

  return (
    <CodeBlock size="sm" className={cn("relative bg-card", className)}>
      <CodeBlockHeader className="border-b pb-2.5">
        <CodeBlockTitle>
          <SquareTerminal />
          {title}
        </CodeBlockTitle>
        <span className="text-xs whitespace-nowrap tabular-nums">
          <AnimatedNumber
            value={lines.length}
            format={(count) => count.toLocaleString()}
          />{" "}
          {lines.length === 1 ? "line" : "lines"}
        </span>
        <CodeBlockActions>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Wrap lines"
            aria-pressed={wrap}
            className={cn(wrap && "bg-foreground/10")}
            onClick={() => setWrap(!wrap)}
          >
            <WrapText />
          </Button>
          <span onPointerDown={prepareCopy} onFocus={prepareCopy}>
            <CodeBlockCopyButton value={copyText} aria-label="Copy the log" />
          </span>
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent
        ref={scroller}
        wrap={wrap}
        className="min-h-0 flex-1 text-[12.5px] leading-5 data-wrap:break-all"
      >
        {lines.length > RENDER_LIMIT && (
          <CodeBlockLine className="text-muted-foreground">
            Showing the last {RENDER_LIMIT.toLocaleString()} lines.
          </CodeBlockLine>
        )}
        {shown.length === 0 && (
          <CodeBlockLine className="text-muted-foreground">
            No output yet.
          </CodeBlockLine>
        )}
        {shown.map((line) => (
          <CodeBlockLine
            key={line.id}
            className="[contain-intrinsic-size:auto_1.25rem] [content-visibility:auto] hover:bg-foreground/5"
          >
            {tagFor?.(line)}
            <AnsiText segments={line.segments} />
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
      {!pinned && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute right-6 bottom-4 shadow-md"
          onClick={jumpToBottom}
        >
          <ArrowDown data-icon="inline-start" />
          {unseen > 0 ? (
            <>
              <AnimatedNumber
                value={unseen}
                format={(count) => count.toLocaleString()}
              />{" "}
              new
            </>
          ) : (
            "Latest"
          )}
        </Button>
      )}
    </CodeBlock>
  )
}
