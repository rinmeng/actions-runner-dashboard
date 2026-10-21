# web

The web dashboard: Next.js with shadcn/ui. To run it with the runners, see the
[main README](../README.md#web-dashboard) (`pnpm web` from the repo root). This page is
for working on it.

## Developing

```sh
pnpm install
pnpm dev          # http://localhost:3000, next to `pnpm start` in the repo root
pnpm lint
pnpm typecheck
pnpm format
```

The dashboard's data comes from the runners' API (`dashboard/api.mjs`), which both
`pnpm start` and `pnpm web` serve on `RUNNERS_API_URL` (default
`http://127.0.0.1:7130`). Without it, the page says the runners are offline.

The routes under `app/api` proxy that API, so a tunnel only needs the site's port:

| Route | |
| --- | --- |
| `GET /api/events` | server-sent events: state and log lines |
| `POST /api/runners/[number]/restart` | restart a stopped runner |
| `GET /api/status` | `{ online, busy, idle, total }`, for the runner-status workflow |

## Settings

In `.env.local`, read at build time (rebuild after changing them):

| Setting | Shown on the offline screen |
| --- | --- |
| `NEXT_PUBLIC_RUNNERS_OWNER` | who to ping, e.g. `Rin` |
| `NEXT_PUBLIC_RUNNERS_HOURS` | when they're usually on |

Keep them in step with `OWNER` and `HOURS` in `../cloudflare/offline-worker.js`.

## Building

`pnpm build` (or `pnpm web:build` from the repo root). Stop the running site first
(`pnpm site:stop`): building while it runs breaks it.

## Adding components

```sh
npx shadcn@latest add button
```

Components go in `components/ui` and import as `@/components/ui/button`.
