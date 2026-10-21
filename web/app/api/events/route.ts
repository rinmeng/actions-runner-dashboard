// Proxies the supervisor's event stream, which only listens on 127.0.0.1.

const API_URL = process.env.RUNNERS_API_URL ?? "http://127.0.0.1:7130"

export async function GET(request: Request) {
  try {
    const upstream = await fetch(`${API_URL}/events`, {
      signal: request.signal,
      cache: "no-store",
    })
    if (!upstream.ok || !upstream.body) throw new Error(`HTTP ${upstream.status}`)
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    })
  } catch {
    return Response.json({ error: "The runners aren't running" }, { status: 503 })
  }
}
