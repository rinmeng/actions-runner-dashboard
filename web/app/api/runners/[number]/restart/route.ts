const API_URL = process.env.RUNNERS_API_URL ?? "http://127.0.0.1:7130"

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/runners/[number]/restart">
) {
  const { number } = await ctx.params
  if (!/^\d+$/.test(number)) {
    return Response.json({ error: "No such runner" }, { status: 404 })
  }
  try {
    const upstream = await fetch(`${API_URL}/runners/${number}/restart`, {
      method: "POST",
      cache: "no-store",
    })
    return Response.json(await upstream.json(), { status: upstream.status })
  } catch {
    return Response.json(
      { error: "The runners aren't running" },
      { status: 503 }
    )
  }
}
