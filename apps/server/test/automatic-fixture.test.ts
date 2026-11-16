import { BunFileSystem, BunPath } from '@effect/platform-bun';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs isolated child-process scenarios to verify automatic server test fixtures     │
 * │ clean SQLite files and directories after success, failures, retries, and concurrent      │
 * │ tests.                                                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Spawns automatic-fixture-scenario.ts in child Vitest processes for success,            │
 * │ failure, retry, cleanup, and concurrency modes. It asserts fixture files and             │
 * │ directories are removed.                                                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Launches lazy fixture scenarios with STUDY_TEST_SCENARIO; the child emits                │
 * │ paths that this parent test checks after exit.                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect, FileSystem, Path } from 'effect';

const runner = Bun.fileURLToPath(
  new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)
);

const config = Bun.fileURLToPath(new URL('./testing/automatic-fixture.config.ts', import.meta.url));

const runnerArgs = [
  '--bun',
  runner,
  'run',
  '--config',
  config,
  '--reporter=verbose',
  '--silent=false'
];

test.stable('pure tests never acquire an unused database fixture', async () => {
  await using directory = await test.temporaryDirectory();
  const child = test.spawnTestProcess([process.execPath, ...runnerArgs], {
    env: { ...process.env, STUDY_TEST_SCENARIO: 'unused', TMPDIR: directory.path },
    stdout: 'pipe',
    stderr: 'pipe'
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ]);

  test.assert.strictEqual(code, 0, stdout + stderr);
});

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
  test.stable(`automatic fixture cleans databases after ${mode}`, async () => {
    const env = { ...process.env, STUDY_TEST_SCENARIO: mode };

    const child = test.spawnTestProcess([process.execPath, ...runnerArgs], {
      env,
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited
    ]);
    const output = stdout + stderr;
    const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));
    const pathsService = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

    test.assert.strictEqual(
      status,
      ['failure', 'setup-failure', 'cleanup-throw', 'failure-cleanup-throw'].includes(mode) ? 1 : 0,
      output
    );
    const paths = [...stdout.matchAll(/FIXTURE_PATH (".*")/g)].map(
      (match) => JSON.parse(match[1]!) as string
    );

    test.assert.strictEqual(paths.length, ['success', 'concurrent'].includes(mode) ? 2 : 1, stdout);
    test.assert.strictEqual(new Set(paths).size, paths.length);

    for (const path of paths) {
      test.assert.match(
        path,
        /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.db$/
      );
      test.assert.strictEqual(await Effect.runPromise(fs.exists(path)), false, path);
      test.assert.strictEqual(
        await Effect.runPromise(fs.exists(pathsService.dirname(path))),
        false,
        pathsService.dirname(path)
      );
    }

    if (['success', 'failure', 'cleanup-throw', 'failure-cleanup-throw'].includes(mode)) {
      test.assert.match(output, /LIVE_SQL_DURING_DISPOSAL/);
      test.assert.match(output, /EXTRA_CONNECTION_CLOSED/);
    }

    if (['retry-sync', 'retry-async'].includes(mode))
      test.assert.match(output, /RETRIED_CLOSE_BEFORE_FILE_CLEANUP/);

    if (['cleanup-throw', 'failure-cleanup-throw'].includes(mode)) {
      if (mode === 'failure-cleanup-throw') test.assert.match(output, /intentional test failure/);
      else test.assert.match(output, /intentional disposer failure/);

      test.assert.match(output, /CLEANUP_THROWN/);
      test.assert.match(output, /CLEANUP_AFTER_THROW/);
    }
  });
}

test.stable('concurrent test files use separate databases and remove them', async () => {
  const env = { ...process.env, STUDY_TEST_SCENARIO: 'success' };
  const results = await Promise.all(
    [0, 1].map(async () => {
      const child = test.spawnTestProcess([process.execPath, ...runnerArgs], {
        env,
        stdout: 'pipe',
        stderr: 'pipe'
      });
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited
      ]);

      test.assert.strictEqual(status, 0, stderr);

      return stdout;
    })
  );
  const paths = results.flatMap((stdout) =>
    [...stdout.matchAll(/FIXTURE_PATH (".*")/g)].map((match) => JSON.parse(match[1]!) as string)
  );

  test.assert.strictEqual(paths.length, 4);
  test.assert.strictEqual(new Set(paths).size, 4);
  const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));
  const pathsService = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

  for (const path of paths)
    test.assert.strictEqual(await Effect.runPromise(fs.exists(pathsService.dirname(path))), false);
});
