import { CircleCheck, CircleSlash, CircleX, Play } from "lucide-react"

import { AnimatedNumber } from "@/components/animated-number"
import { duration } from "@/lib/format"
import type { Job, Runner } from "@/lib/types"
import { cn } from "@/lib/utils"

const RESULT_ICON: Record<string, React.ReactNode> = {
  Succeeded: <CircleCheck className="size-3.5 text-emerald-500" />,
  Failed: <CircleX className="size-3.5 text-red-500" />,
  Canceled: <CircleSlash className="size-3.5 text-muted-foreground" />,
}

// "42s" while running, "done in 3m 05s" after, its digits rolling as they tick.
function jobTime(job: Job, running: boolean, now: number) {
  // Unknown when the job started before the dashboard did.
  if (!job.startedAt) return null
  if (running)
    return <AnimatedNumber value={now - job.startedAt} format={duration} />
  if (!job.finishedAt) return null
  return (
    <>
      done in{" "}
      <AnimatedNumber
        value={job.finishedAt - job.startedAt}
        format={duration}
      />
    </>
  )
}

export function PrLink({ job }: { job: Job }) {
  if (!job.pr || !job.repoUrl)
    return job.event ? <span>{job.event}</span> : null
  return (
    <a
      href={`${job.repoUrl}/pull/${job.pr}`}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
      onClick={(event) => event.stopPropagation()}
    >
      PR #{job.pr}
    </a>
  )
}

// The current or last job: "▶ Workflow › Job @actor PR #12 (42s)".
export function JobSummary({
  runner,
  now,
  compact = false,
  className,
}: {
  runner: Runner
  now: number
  compact?: boolean
  className?: string
}) {
  const running = Boolean(runner.job)
  const job = runner.job ?? runner.last
  if (!job) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        {runner.status === "idle" ? "Waiting for a job" : ""}
      </span>
    )
  }
  const icon = running ? (
    <Play className="size-3.5 fill-amber-500 text-amber-500" />
  ) : (
    (RESULT_ICON[job.result ?? ""] ?? null)
  )
  const time = jobTime(job, running, now)

  if (compact) {
    return (
      <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
        <span className="shrink-0">{icon}</span>
        <span className="truncate">
          {job.actor && <span className="font-medium">@{job.actor} </span>}
          <span className="text-muted-foreground">
            {job.workflow || job.name}
          </span>
        </span>
        {time && (
          <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
            {time}
          </span>
        )}
      </span>
    )
  }
  return (
    <span
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5",
        className
      )}
    >
      {icon}
      {job.workflow && (
        <span className="text-muted-foreground">{job.workflow} ›</span>
      )}
      <span className="font-medium">{job.name}</span>
      {job.actor && (
        <span className="text-muted-foreground">
          by <span className="font-medium text-foreground">@{job.actor}</span>
        </span>
      )}
      <span className="text-muted-foreground">
        <PrLink job={job} />
      </span>
      {time && (
        <span className="text-muted-foreground tabular-nums">({time})</span>
      )}
    </span>
  )
}
