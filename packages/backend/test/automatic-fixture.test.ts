import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const preload = fileURLToPath(new URL('./testing/preload.ts', import.meta.url));

const scenario = fileURLToPath(new URL('./testing/automatic-fixture-scenario.ts', import.meta.url));

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
  test(`automatic fixture cleans databases after ${mode}`, () => {
    const env: NodeJS.ProcessEnv = { ...process.env, STUDY_TEST_SCENARIO: mode };

    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ['--import', preload, '--test', scenario], {
      encoding: 'utf8',
      env
    });

    assert.equal(
      child.status,
      mode === 'failure' ||
        mode === 'setup-failure' ||
        mode === 'cleanup-throw' ||
        mode === 'failure-cleanup-throw'
        ? 1
        : 0,
      child.stderr + child.stdout
    );
    const paths = [...child.stdout.matchAll(/FIXTURE_PATH (".*")/g)].map(
      (match) => JSON.parse(match[1]!) as string
    );

    assert.equal(paths.length, mode === 'success' || mode === 'concurrent' ? 2 : 1, child.stdout);
    assert.equal(new Set(paths).size, paths.length);

    for (const path of paths) {
      assert.match(
        path,
        /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.db$/
      );
      assert.equal(existsSync(path), false, path);
      assert.equal(existsSync(dirname(path)), false, dirname(path));
    }

    if (
      mode === 'success' ||
      mode === 'failure' ||
      mode === 'cleanup-throw' ||
      mode === 'failure-cleanup-throw'
    ) {
      assert.match(child.stdout, /LIVE_SQL_DURING_DISPOSAL/);
      assert.match(child.stdout, /EXTRA_CONNECTION_CLOSED/);
    }

    if (mode === 'retry-sync' || mode === 'retry-async')
      assert.match(child.stdout, /RETRIED_CLOSE_BEFORE_FILE_CLEANUP/);

    if (mode === 'cleanup-throw' || mode === 'failure-cleanup-throw') {
      if (mode === 'failure-cleanup-throw') assert.match(child.stdout, /intentional test failure/);
      else assert.match(child.stdout, /Test resource cleanup failed/);

      assert.match(child.stdout, /CLEANUP_THROWN/);
      assert.match(child.stdout, /CLEANUP_AFTER_THROW/);
    }
  });
}

const exec = promisify(execFile);

test('concurrent test files use separate databases and remove them', async () => {
  const env: NodeJS.ProcessEnv = { ...process.env, STUDY_TEST_SCENARIO: 'success' };

  delete env.NODE_TEST_CONTEXT;
  const args = ['--import', preload, '--test', scenario];
  const results = await Promise.all([
    exec(process.execPath, args, { env }),
    exec(process.execPath, args, { env })
  ]);
  const paths = results.flatMap(({ stdout }) =>
    [...stdout.matchAll(/FIXTURE_PATH (".*")/g)].map((match) => JSON.parse(match[1]!) as string)
  );

  assert.equal(paths.length, 4);
  assert.equal(new Set(paths).size, 4);

  for (const path of paths) assert.equal(existsSync(dirname(path)), false);
});
