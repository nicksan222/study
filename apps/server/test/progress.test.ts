/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies native Vitest progress and failure-only diagnostics in isolated           │
 * │ subprocesses.                                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks passing output stays quiet and failed output retains diagnostics.               │
 * │ - Confirms phase helpers preserve returned values and original operation failures.       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the real test CLI and temporary files without replacing application services.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { testStable } from '@study/testing/vitest';
import { Effect, FileSystem, Path } from 'effect';
import { expect } from 'vite-plus/test';

import { inTestPhase } from '#testing/progress';

const runner = Bun.fileURLToPath(
  new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)
);

for (const mode of ['pass', 'fail', 'imported-fail']) {
  const fails = mode !== 'pass';

  testStable(`progress keeps test results and filters diagnostics for ${mode}`, async () => {
    const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));
    const paths = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));
    const directory = await Effect.runPromise(fs.makeTempDirectory({ prefix: 'study-reporter-' }));
    const fixture = paths.join(directory, 'fixture.test.mjs');
    const definition = mode === 'imported-fail' ? paths.join(directory, 'definition.mjs') : fixture;
    const config = paths.join(directory, 'vite.config.mjs');

    try {
      await Effect.runPromise(
        fs.symlink(
          Bun.fileURLToPath(new URL('../../../node_modules', import.meta.url)),
          paths.join(directory, 'node_modules')
        )
      );
      await Bun.write(
        config,
        `export default { test: { fsModuleCache: false, include: ['*.test.mjs'], reporters: ['verbose'], silent: 'passed-only', maxWorkers: 1 } };`
      );
      await Bun.write(
        paths.join(directory, 'passing.test.mjs'),
        `import { testStable } from '@study/testing/vitest'; testStable('other passing result', () => console.log('other passing output'));`
      );
      await Bun.write(
        definition,
        `import { testStable } from '@study/testing/vitest'; import { assert } from 'vite-plus/test'; testStable('visible test result', () => { console.log('fixture stdout'); console.error('fixture stderr'); console.debug('fixture phase'); if (${fails}) assert.fail('intentional failure'); });`
      );

      if (definition !== fixture) await Bun.write(fixture, `import './definition.mjs';`);

      const child = Bun.spawn(
        [process.execPath, '--bun', runner, 'run', '--root', directory, '--config', config],
        { stdout: 'pipe', stderr: 'pipe' }
      );
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited
      ]);
      const output = stdout + stderr;

      expect(status, output).toBe(fails ? 1 : 0);
      expect(output).toMatch(/visible test result/);
      expect(output).toMatch(/other passing result/);
      expect(output).not.toMatch(/other passing output/);

      for (const message of ['fixture stdout', 'fixture stderr', 'fixture phase']) {
        expect(output.includes(message), output).toBe(fails);
      }

      if (fails) expect(output).toMatch(/intentional failure/);
    } finally {
      await Effect.runPromise(fs.remove(directory, { recursive: true, force: true }));
    }
  });
}

testStable('phase diagnostics preserve operation results and failures', async (context) => {
  await expect(inTestPhase(context, 'success', async () => 42)).resolves.toBe(42);
  const failure = new Error('operation failure');

  await expect(
    inTestPhase(context, 'failure', () => {
      throw failure;
    })
  ).rejects.toBe(failure);
});
