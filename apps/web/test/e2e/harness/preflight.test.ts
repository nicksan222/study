import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';
import { createVitest } from 'vite-plus/test/node';

testStable(
  'native suite preflight rejects cross-file identities before baseline writes, including filtered titles',
  async () => {
    for (const titles of [
      ['Notes retain edits', 'Notes: retain edits'],
      ['Notes retain edits', 'Notes retain edits']
    ]) {
      const directory = `test-results/collisions-${crypto.randomUUID()}`;
      const marker = `${directory}/baseline.png`;

      for (const [index, title] of titles.entries())
        await Bun.write(
          `${directory}/${index}.test.ts`,
          `
        import { test as testE2e } from 'vite-plus/test';
        testE2e(${JSON.stringify(title)}, async () => { await Bun.write(${JSON.stringify(marker)}, 'must not run'); });
      `
        );

      const runner = await createVitest('test', {
        config: false,
        root: process.cwd(),
        include: [`${directory}/*.test.ts`],
        globalSetup: [Bun.fileURLToPath(new URL('./preflight.ts', import.meta.url))],
        testNamePattern: 'Notes retain edits',
        watch: false,
        maxWorkers: 2
      });

      const exitCode = process.exitCode;

      try {
        const error = await runner.start().then(
          () => undefined,
          (failure: unknown) => failure
        );

        expect(await Bun.file(marker).exists()).toBe(false);
        expect(error instanceof Error ? error.message : undefined).toContain(
          'Baseline identity collision'
        );
      } finally {
        await runner.close();
        // The expected nested runner error must not mark the enclosing test process failed.
        process.exitCode = exitCode;
      }
    }
  }
);
