import { testPolicy } from '@study/testing';
import { spawnScopedProcess } from '@study/testing/process';

import { safeName } from './identity.ts';

const scope = process.argv[2];

if (!scope || scope.split('/').length > 2)
  throw new Error('Supply one workflow or workflow/screenshot name');

for (const segment of scope.split('/')) safeName(segment);

if (process.env.CI) throw new Error('Baseline updates are forbidden in CI');

const updateRun = crypto.randomUUID();

const root = Bun.fileURLToPath(new URL('../../../../../', import.meta.url));

const client = Bun.fileURLToPath(new URL('../../../', import.meta.url));

await using child = spawnScopedProcess(['bun', 'run', 'web:e2e'], {
  timeout: testPolicy.suiteTimeout,
  cwd: root,
  env: { ...process.env, E2E_UPDATE: scope, E2E_UPDATE_RUN: updateRun },
  stdout: 'inherit',
  stderr: 'inherit'
});

const exitCode = await child.exited;

if (exitCode) process.exit(exitCode);

const captures = [
  ...new Bun.Glob(`test-results/updates/${updateRun}/*.json`).scanSync({ cwd: client })
];

if (!captures.length)
  throw new Error(`No screenshot matched ${scope}; check the workflow/screenshot name`);
