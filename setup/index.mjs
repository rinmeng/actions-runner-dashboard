// Downloads the GitHub Actions runner and creates, then registers, runner folders
// (actions-runner, actions-runner-2, …) in RUNNERS_HOME until there are --count of them.
//
//   pnpm setup-runners --repo owner/repo --count 4 [--labels my-pc] [--name my-pc] [--dry-run]
//   pnpm setup-runners --org my-org --count 4 …
//
// Needs `gh`, signed in as someone who can add runners to the repo (admin) or org.
// Runners that already exist are left alone, so it's safe to re-run with a higher count.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';

import { home, runners, system32 } from '../dashboard/state.mjs';

const NAME = /^[\w.-]+$/;
const LABELS = /^[\w.-]+(,[\w.-]+)*$/;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const { values: args } = parseArgs({
  options: {
    repo: { type: 'string' },
    org: { type: 'string' },
    count: { type: 'string', default: '4' },
    labels: { type: 'string' },
    name: { type: 'string', default: hostname().toLowerCase() },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (process.platform !== 'win32') fail('This sets up Windows runners; run it on Windows.');
if (!args.repo === !args.org) fail('Pass exactly one of --repo owner/repo or --org org.');
if (args.repo && !/^[\w.-]+\/[\w.-]+$/.test(args.repo)) fail(`--repo should look like owner/repo, not "${args.repo}".`);
const count = Number(args.count);
if (!Number.isInteger(count) || count < 1 || count > 50) fail('--count should be a whole number from 1 to 50.');
if (!NAME.test(args.name)) fail('--name may only use letters, digits, ".", "-" and "_".');
if (args.labels && !LABELS.test(args.labels)) fail('--labels should be comma-separated, like "my-pc,gpu".');

const scope = args.repo ? `repos/${args.repo}` : `orgs/${args.org}`;
const url = `https://github.com/${args.repo ?? args.org}`;

// Runners already here must belong to the same repo or org, or the dashboard would mix them.
for (const runner of runners) {
  const config = JSON.parse(readFileSync(join(runner.dir, '.runner'), 'utf8').replace(/^﻿/, ''));
  if (config.gitHubUrl.toLowerCase() !== url.toLowerCase()) {
    fail(`${runner.dir} is registered to ${config.gitHubUrl}, not ${url}. Use a different RUNNERS_HOME.`);
  }
}

const existing = new Set(runners.map((runner) => runner.number));
const missing = [];
for (let number = 1; number <= count; number++) {
  if (existing.has(number)) continue;
  missing.push({
    number,
    dir: join(home, number === 1 ? 'actions-runner' : `actions-runner-${number}`),
    name: number === 1 ? args.name : `${args.name}-${number}`,
  });
}

console.log(`Runners in ${home}: ${runners.length} set up, ${count} wanted.`);
if (missing.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}
for (const runner of missing) console.log(`  + ${runner.dir}  as "${runner.name}"`);
console.log(`  registered to ${url}${args.labels ? ` with labels ${args.labels}` : ''}`);
if (args['dry-run']) process.exit(0);

function gh(ghArgs) {
  const result = spawnSync('gh', ghArgs, { encoding: 'utf8', windowsHide: true });
  if (result.error) fail('`gh` was not found. Install it from https://cli.github.com and run `gh auth login`.');
  if (result.status !== 0) fail(`gh ${ghArgs.join(' ')} failed:\n${result.stderr.trim()}`);
  return result.stdout.trim();
}

// --- Download -------------------------------------------------------------------

const release = JSON.parse(gh(['api', 'repos/actions/runner/releases/latest']));
const version = release.tag_name.replace(/^v/, '');
const asset = release.assets.find((candidate) => /^actions-runner-win-x64-[\d.]+\.zip$/.test(candidate.name));
// The release notes list each download's SHA-256 between these markers.
const expectedHash = /<!-- BEGIN SHA win-x64 -->([0-9a-f]{64})<!-- END SHA win-x64 -->/.exec(release.body)?.[1];
if (!asset || !expectedHash) fail(`Couldn't find the Windows x64 download in runner release ${version}.`);

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const zip = join(tmpdir(), asset.name);
if (!existsSync(zip) || sha256(zip) !== expectedHash) {
  console.log(`Downloading runner ${version}…`);
  const response = await fetch(asset.browser_download_url);
  if (!response.ok) fail(`Download failed: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(zip));
  if (sha256(zip) !== expectedHash) fail(`${zip} doesn't match the published checksum; not using it.`);
}
console.log(`Runner ${version} downloaded and verified.`);

// --- Create and register ---------------------------------------------------------

// Tokens last an hour; one is enough for every runner in this run.
const token = gh(['api', '-X', 'POST', `${scope}/actions/runners/registration-token`, '--jq', '.token']);
// Settings like PYTHONNOUSERSITE live in .env; new runners copy it from an existing one.
const envFile = runners.map((runner) => join(runner.dir, '.env')).find((file) => existsSync(file));

for (const runner of missing) {
  console.log(`\nSetting up ${runner.dir}…`);
  mkdirSync(runner.dir, { recursive: true });
  if (!existsSync(join(runner.dir, 'config.cmd'))) {
    const extract = spawnSync(join(system32, 'tar.exe'), ['-xf', zip, '-C', runner.dir], { stdio: 'inherit' });
    if (extract.status !== 0) fail(`Extracting into ${runner.dir} failed.`);
  }
  if (envFile && !existsSync(join(runner.dir, '.env'))) copyFileSync(envFile, join(runner.dir, '.env'));

  const configure = [
    `"${join(runner.dir, 'config.cmd')}"`,
    '--unattended',
    `--url ${url}`,
    `--token ${token}`,
    `--name ${runner.name}`,
    '--work _work',
    '--replace',
    ...(args.labels ? [`--labels ${args.labels}`] : []),
  ].join(' ');
  // cmd /s /c "…" strips only the outer quotes, keeping the quoted path intact.
  const result = spawnSync(join(system32, 'cmd.exe'), [`/d /s /c "${configure}"`], {
    cwd: runner.dir,
    stdio: 'inherit',
    windowsVerbatimArguments: true,
  });
  if (result.status !== 0) fail(`Registering ${runner.name} failed; fix the error above and re-run.`);
}

console.log(`\nDone: ${count} runners in ${home}. Start them with \`pnpm start\`.`);
