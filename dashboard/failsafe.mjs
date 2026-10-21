// Stops every runner, as q or Ctrl+C does, when the runners' own share of the CPU, RAM
// or GPU stays above its limit for RUNNERS_LIMIT_MINUTES. Other programs' use doesn't
// count. Limits are percent of the whole machine; 0 turns one off.
//
//   RUNNERS_LIMIT_CPU=90  RUNNERS_LIMIT_RAM=70  RUNNERS_LIMIT_GPU=90  RUNNERS_LIMIT_MINUTES=5

import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { log, quit } from './runners.mjs';
import { runners, state } from './state.mjs';
import { red } from './text.mjs';

const setting = (name, fallback) => {
  const value = parseFloat(process.env[name] ?? '');
  return Number.isFinite(value) ? value : fallback;
};

const LIMITS = {
  cpu: setting('RUNNERS_LIMIT_CPU', 90),
  ram: setting('RUNNERS_LIMIT_RAM', 70),
  gpu: setting('RUNNERS_LIMIT_GPU', 90),
};
const SUSTAINED_MS = setting('RUNNERS_LIMIT_MINUTES', 5) * 60_000;
// Why it stopped, kept after the window and the page are gone.
const FAILSAFE_LOG = join(dirname(fileURLToPath(import.meta.url)), '../failsafe.log');

// When each resource went over its limit, while it stays over.
const overSince = {};

// The runners' share of each resource, in percent of the machine.
const shares = (usage) => ({
  cpu: usage.cpu.runners,
  ram: (usage.ram.runners / usage.ram.total) * 100,
  gpu: usage.gpu.runners,
});

// Called with each usage sample.
export function checkLimits(usage, now = Date.now()) {
  if (state.quitting) return;
  for (const [resource, share] of Object.entries(shares(usage))) {
    const limit = LIMITS[resource];
    if (!limit || share < limit) {
      delete overSince[resource];
      continue;
    }
    overSince[resource] ??= now;
    if (now - overSince[resource] >= SUSTAINED_MS) {
      trip(`Runners used ${Math.round(share)}% of the ${resource.toUpperCase()} (limit ${limit}%) for ${SUSTAINED_MS / 60_000} minutes. Stopping every runner.`);
      return;
    }
  }
}

function trip(message) {
  for (const runner of runners) log(runner, red(`Failsafe: ${message}`));
  console.error(`Failsafe: ${message}`);
  try {
    appendFileSync(FAILSAFE_LOG, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // The log line above still says why.
  }
  quit();
}
