import { cn } from "@/lib/utils"
import type { Segment } from "@/lib/types"

// One log line's styled segments, colored like the terminal.
export function AnsiText({ segments }: { segments: Segment[] }) {
  return segments.map((segment, index) => {
    const className = cn(
      segment.bold && "font-semibold",
      segment.dim && "opacity-60",
      segment.italic && "italic",
      segment.underline && "underline"
    )
    const style =
      segment.fg === undefined
        ? undefined
        : { color: typeof segment.fg === "number" ? `var(--ansi-${segment.fg})` : segment.fg }
    if (segment.url) {
      return (
        <a
          key={index}
          href={segment.url}
          target="_blank"
          rel="noreferrer"
          className={cn(className, "underline decoration-dotted underline-offset-2 hover:decoration-solid")}
          style={style}
        >
          {segment.text}
        </a>
      )
    }
    return (
      <span key={index} className={className || undefined} style={style}>
        {segment.text}
      </span>
    )
  })
}
