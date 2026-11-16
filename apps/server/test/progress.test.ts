import { BunFileSystem, BunPath } from '@effect/platform-bun';
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
import { test } from '@study/testing';
import { Effect, FileSystem, Path } from 'effect';

import { inTestPhase } from '#testing/progress';

const runner = Bun.fileURLToPath(
  new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)
);

for (const mode of ['pass', 'fail', 'imported-fail']) {
  const fails = mode !== 'pass';

  test.stable(
    `progress keeps test results and filters diagnostics for ${mode}`,
    async ({ task: _task, temporaryDirectory, spawnTestProcess, expect }) => {
      const fs = await Effect.runPromise(
        Effect.provide(FileSystem.FileSystem, BunFileSystem.layer)
      );
      const paths = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));
      await using temporary = await temporaryDirectory({ prefix: 'study-reporter-' });
      const directory = temporary.path;
      const fixture = paths.join(directory, 'fixture.test.mjs');
      const definition =
        mode === 'imported-fail' ? paths.join(directory, 'definition.mjs') : fixture;
      const config = paths.join(directory, 'vite.config.mjs');
      const setup = Bun.fileURLToPath(new URL('./testing/setup.ts', import.meta.url));

      await Effect.runPromise(
        fs.symlink(
          Bun.fileURLToPath(new URL('../../../node_modules', import.meta.url)),
          paths.join(directory, 'node_modules')
        )
      );
      await Bun.write(
        config,
        `export default { test: { fsModuleCache: false, include: ['*.test.mjs'], setupFiles: [${JSON.stringify(setup)}], reporters: ['verbose'], silent: 'passed-only', maxWorkers: 1 } };`
      );
      await Bun.write(
        paths.join(directory, 'passing.test.mjs'),
        `import { test } from '@study/testing'; test.stable('other passing result', ({ task: _task }) => console.log('other passing output'));`
      );
      await Bun.write(
        definition,
        `import { test } from '@study/testing'; import { assert } from 'vite-plus/test'; test.stable('visible test result', ({ task: _task }) => { console.log('fixture stdout'); console.error('fixture stderr'); console.debug('fixture phase'); if (${fails}) assert.fail('intentional failure'); });`
      );

      if (definition !== fixture) await Bun.write(fixture, `import './definition.mjs';`);

      const child = spawnTestProcess(
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
    }
  );
}

test.stable(
  'phase diagnostics preserve operation results and failures',
  async ({ task: _task, expect }) => {
    await expect(inTestPhase(undefined, 'success', async () => 42)).resolves.toBe(42);
    const failure = new Error('operation failure');

    await expect(
      inTestPhase(undefined, 'failure', () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  }
);
