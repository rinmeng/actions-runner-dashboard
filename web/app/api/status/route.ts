// Whether the runners are up, for the runner-status workflow
// (.github/workflows/runner-status.yml) and anything else that asks. Only labels
// and statuses: no repos, jobs or logs.

const API_URL = process.env.RUNNERS_API_URL ?? "http://127.0.0.1:7130"

type Status = { quitting: boolean; runners: { label: string; status: string }[] }

export async function GET() {
  let status: Status | null = null
  try {
    const upstream = await fetch(`${API_URL}/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    })
    if (upstream.ok) status = await upstream.json()
  } catch {
    // The runners aren't running; the site is.
  }
  const runners = status?.runners ?? []
  const count = (name: string) => runners.filter((runner) => runner.status === name).length
  const busy = count("busy")
  const idle = count("idle")
  return Response.json(
    {
      // Online when at least one runner can take a job or is running one.
      online: Boolean(status) && !status?.quitting && busy + idle > 0,
      busy,
      idle,
      total: runners.length,
      runners,
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
