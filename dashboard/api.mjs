// A small HTTP API for the web dashboard (web/), on 127.0.0.1 only. The Next.js
// app proxies it, so only that is ever exposed.
//
//   GET  /events                Server-sent events: "snapshot" first, then "line",
//                               "line-update" and "state" as things change
//   POST /runners/<n>/restart   start a stopped or failed runner

import { createServer } from 'node:http';
import { uptime } from 'node:os';

import { toSegments } from './ansi.mjs';
import { restart } from './runners.mjs';
import { events, runners, state } from './state.mjs';

export const API_PORT = Number(process.env.RUNNERS_API_PORT ?? 7130);
// Lines per runner sent when a browser connects; the rest stay in the terminal's scrollback.
const SNAPSHOT_LINES = 1000;
// "state" events are coalesced to at most one per this many ms.
const STATE_INTERVAL_MS = 250;
const HEARTBEAT_MS = 15_000;

const JOB_FIELDS = ['name', 'workflow', 'actor', 'event', 'pr', 'repoUrl', 'startedAt', 'finishedAt', 'result'];
const job = (value) => (value ? Object.fromEntries(JOB_FIELDS.map((key) => [key, value[key] ?? null])) : null);

const line = (entry) => ({ id: entry.id, at: entry.at, runner: entry.runner.number, segments: toSegments(entry.text) });

function stateMessage() {
  return {
    uptime: uptime(),
    quitting: state.quitting,
    usage: state.usage ?? null,
    peak: state.peak ?? null,
    range: state.range ?? {},
    runners: runners.map((runner) => ({
      number: runner.number,
      label: runner.label,
      name: runner.name,
      status: runner.status,
      job: job(runner.job),
      last: job(runner.last),
    })),
  };
}

function snapshot() {
  return {
    ...stateMessage(),
    lines: runners.flatMap((runner) => runner.lines.slice(-SNAPSHOT_LINES)).sort((a, b) => a.id - b.id).map(line),
  };
}

function streamEvents(request, response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Stops proxies (and cloudflared) from buffering the stream.
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('snapshot', snapshot());

  let statePending = null;
  const onChange = () => {
    statePending ??= setTimeout(() => {
      statePending = null;
      send('state', stateMessage());
    }, STATE_INTERVAL_MS);
  };
  const onLine = (entry) => send('line', line(entry));
  const onLineUpdate = (entry) => send('line-update', line(entry));
  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), HEARTBEAT_MS);

  events.on('change', onChange);
  events.on('line', onLine);
  events.on('line-update', onLineUpdate);
  request.on('close', () => {
    clearTimeout(statePending);
    clearInterval(heartbeat);
    events.off('change', onChange);
    events.off('line', onLine);
    events.off('line-update', onLineUpdate);
  });
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function handle(request, response) {
  const url = new URL(request.url, 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/events') return streamEvents(request, response);

  const restartMatch = /^\/runners\/(\d+)\/restart$/.exec(url.pathname);
  if (request.method === 'POST' && restartMatch) {
    const runner = runners.find((candidate) => candidate.number === Number(restartMatch[1]));
    if (!runner) return json(response, 404, { error: 'No such runner' });
    if (runner.child) return json(response, 409, { error: `${runner.label} is already running` });
    if (state.quitting) return json(response, 409, { error: 'The runners are shutting down' });
    restart(runner);
    return json(response, 200, { ok: true });
  }
  json(response, 404, { error: 'Not found' });
}

export function startApi() {
  const server = createServer(handle);
  server.on('error', (error) => {
    // The runners keep going without the web dashboard.
    process.stderr.write(`Web dashboard API not started: ${error.message}\n`);
  });
  server.listen(API_PORT, '127.0.0.1');
  server.unref();
  return server;
}
