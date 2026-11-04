/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs isolated child-process scenarios to verify automatic server test fixtures     │
 * │ clean SQLite files and directories after success, failures, retries, and concurrent      │
 * │ tests.                                                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Spawns automatic-fixture-scenario.ts in child Vitest processes for success,            │
 * │   failure, retry, cleanup, and concurrency modes. It asserts fixture files and           │
 * │   directories are removed.                                                               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Launches the scenario with the testing preload and STUDY_TEST_SCENARIO; the child emits  │
 * │ paths that this parent test checks after exit.                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { execFile, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

const runner = fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url));

const config = fileURLToPath(new URL('./testing/automatic-fixture.config.ts', import.meta.url));

const runnerArgs = [runner, 'run', '--config', config, '--reporter=verbose', '--silent=false'];

for (const mode of [
  'success',
  'failure',
  'setup-failure',
  'concurrent',
  'cleanup-throw',
  'failure-cleanup-throw',
  'retry-sync',
  'retry-async',
  'api-reuse'
] as const) {
  testStable(`automatic fixture cleans databases after ${mode}`, () => {
    const env: NodeJS.ProcessEnv = { ...process.env, STUDY_TEST_SCENARIO: mode };

    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, runnerArgs, {
      encoding: 'utf8',
      env
    });

    const output = child.stdout + child.stderr;

    assert.strictEqual(
      child.status,
      ['failure', 'setup-failure', 'cleanup-throw', 'failure-cleanup-throw'].includes(mode) ? 1 : 0,
      child.stderr + child.stdout
    );
    const paths = [...child.stdout.matchAll(/FIXTURE_PATH (".*")/g)].map(
      (match) => JSON.parse(match[1]!) as string
    );

    assert.strictEqual(
      paths.length,
      ['success', 'concurrent'].includes(mode) ? 2 : 1,
      child.stdout
    );
    assert.strictEqual(new Set(paths).size, paths.length);

    for (const path of paths) {
      assert.match(
        path,
        /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.db$/
      );
      assert.strictEqual(existsSync(path), false, path);
      assert.strictEqual(existsSync(dirname(path)), false, dirname(path));
    }

    if (['success', 'failure', 'cleanup-throw', 'failure-cleanup-throw'].includes(mode)) {
      assert.match(output, /LIVE_SQL_DURING_DISPOSAL/);
      assert.match(output, /EXTRA_CONNECTION_CLOSED/);
    }

    if (['retry-sync', 'retry-async'].includes(mode))
      assert.match(output, /RETRIED_CLOSE_BEFORE_FILE_CLEANUP/);

    if (['cleanup-throw', 'failure-cleanup-throw'].includes(mode)) {
      if (mode === 'failure-cleanup-throw') assert.match(output, /intentional test failure/);
      else assert.match(output, /intentional disposer failure/);

      assert.match(output, /CLEANUP_THROWN/);
      assert.match(output, /CLEANUP_AFTER_THROW/);
    }
  });
}

const exec = promisify(execFile);

testStable('concurrent test files use separate databases and remove them', async () => {
  const env: NodeJS.ProcessEnv = { ...process.env, STUDY_TEST_SCENARIO: 'success' };

  delete env.NODE_TEST_CONTEXT;
  const args = runnerArgs;
  const results = await Promise.all([
    exec(process.execPath, args, { env }),
    exec(process.execPath, args, { env })
  ]);
  const paths = results.flatMap(({ stdout }) =>
    [...stdout.matchAll(/FIXTURE_PATH (".*")/g)].map((match) => JSON.parse(match[1]!) as string)
  );

  assert.strictEqual(paths.length, 4);
  assert.strictEqual(new Set(paths).size, 4);

  for (const path of paths) assert.strictEqual(existsSync(dirname(path)), false);
});
