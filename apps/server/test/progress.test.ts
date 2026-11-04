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

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { inTestPhase } from '#testing/progress';

const runner = fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url));

for (const mode of ['pass', 'fail', 'imported-fail']) {
  const fails = mode !== 'pass';

  testStable(`progress keeps test results and filters diagnostics for ${mode}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'study-reporter-'));
    const fixture = join(directory, 'fixture.test.mjs');
    const definition = mode === 'imported-fail' ? join(directory, 'definition.mjs') : fixture;
    const config = join(directory, 'vite.config.mjs');

    try {
      symlinkSync(
        fileURLToPath(new URL('../../../node_modules', import.meta.url)),
        join(directory, 'node_modules'),
        'dir'
      );
      writeFileSync(
        config,
        `export default { test: { fsModuleCache: false, include: ['*.test.mjs'], reporters: ['verbose'], silent: 'passed-only', maxWorkers: 1 } };`
      );
      writeFileSync(
        join(directory, 'passing.test.mjs'),
        `import { testStable } from '@study/testing/vitest'; testStable('other passing result', () => console.log('other passing output'));`
      );
      writeFileSync(
        definition,
        `import { testStable } from '@study/testing/vitest'; import { assert } from 'vite-plus/test'; testStable('visible test result', () => { console.log('fixture stdout'); console.error('fixture stderr'); console.debug('fixture phase'); if (${fails}) assert.fail('intentional failure'); });`
      );

      if (definition !== fixture) writeFileSync(fixture, `import './definition.mjs';`);

      const child = spawnSync(
        process.execPath,
        [runner, 'run', '--root', directory, '--config', config],
        { encoding: 'utf8' }
      );
      const output = child.stdout + child.stderr;

      expect(child.status, output).toBe(fails ? 1 : 0);
      expect(output).toMatch(/visible test result/);
      expect(output).toMatch(/other passing result/);
      expect(output).not.toMatch(/other passing output/);

      for (const message of ['fixture stdout', 'fixture stderr', 'fixture phase']) {
        expect(output.includes(message), output).toBe(fails);
      }

      if (fails) expect(output).toMatch(/intentional failure/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
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
