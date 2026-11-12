import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';
import { createVitest } from 'vite-plus/test/node';

testStable(
  'native suite preflight rejects cross-file identities before baseline writes, including filtered titles',
  async () => {
    for (const titles of [
      ['Notes retain edits', 'Notes: retain edits'],
      ['Notes retain edits', 'Notes retain edits'],
      ['Notes\nretain edits', 'Notes retain edits'],
      ['Notes\tretain edits', 'Notes retain edits'],
      ['Notes\u00a0retain edits', 'Notes retain edits']
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
        expect(error instanceof Error ? error.message : undefined).toMatch(
          /Baseline identity collision|Unsupported escape in E2E title/
        );
      } finally {
        await runner.close();
        // The expected nested runner error must not mark the enclosing test process failed.
        process.exitCode = exitCode;
      }
    }
  }
);

testStable('scoped updates resolve the exact title after full native preflight', async () => {
  const directory = `test-results/update-selection-${crypto.randomUUID()}`;
  const titles = [
    '2 Notes: retain edits. [draft]?',
    'Reopened 2 Notes: retain edits. [draft]?',
    'Notes "retain" edits.'
  ];

  for (const [index, title] of titles.entries())
    await Bun.write(
      `${directory}/${index}.test.ts`,
      `
      import { test as testE2e } from 'vite-plus/test';
      testE2e(${JSON.stringify(title)}, async () => { await Bun.write(${JSON.stringify(`${directory}/${index}.txt`)}, ${JSON.stringify(title)}); });
    `
    );

  const previousScope = process.env.E2E_UPDATE;

  try {
    for (const [workflow, title] of [
      ['2-notes-retain-edits-draft', titles[0]],
      ['notes-retain-edits', titles[2]]
    ]) {
      process.env.E2E_UPDATE = workflow;
      const runner = await createVitest('test', {
        config: false,
        root: process.cwd(),
        include: [`${directory}/*.test.ts`],
        globalSetup: [Bun.fileURLToPath(new URL('./preflight.ts', import.meta.url))],
        watch: false,
        maxWorkers: 2
      });

      try {
        await runner.start();
        expect(runner.state.getUnhandledErrors()).toEqual([]);
        for (const [index, candidate] of titles.entries()) {
          const marker = Bun.file(`${directory}/${index}.txt`);

          expect(await marker.exists()).toBe(candidate === title);
          if (await marker.exists()) await marker.delete();
        }
      } finally {
        await runner.close();
      }
    }
  } finally {
    if (previousScope === undefined) delete process.env.E2E_UPDATE;
    else process.env.E2E_UPDATE = previousScope;
  }
});
