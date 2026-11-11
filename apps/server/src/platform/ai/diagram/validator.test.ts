/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises native runtime validator behavior through real persistence boundaries.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies diagram parser does not inherit application preloads.                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { diagramFeedback } from './validator.ts';

testStable('diagram parser does not inherit application preloads', async () => {
  const preload = `${Bun.env.TMPDIR ?? '/tmp'}/study-diagram-${crypto.randomUUID()}.ts`;
  const validator = new URL('./validator.ts', import.meta.url).href;
  const script = `Promise.all([import('effect'), import(${JSON.stringify(validator)})])
    .then(async ([{ Effect }, { diagramFeedback }]) => {
      const result = await Effect.runPromise(diagramFeedback('flowchart TD\\nA["alpha"] --> B["beta"]'));
      if (result !== undefined) throw new Error(result);
    }).catch(error => { console.error(error); process.exitCode = 1; });`;

  await Bun.write(
    preload,
    "if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) throw new Error('Application preload ran in the diagram worker');"
  );

  try {
    const child = Bun.spawn([process.execPath, '--preload', preload, '--eval', script], {
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const timeout = setTimeout(() => child.kill(), 30000);

    try {
      const stderr = await new Response(child.stderr).text();

      assert.strictEqual(await child.exited, 0, stderr);
      assert.strictEqual(stderr, '');
    } finally {
      clearTimeout(timeout);

      if (child.exitCode === null && child.signalCode === null) child.kill();

      await child.exited;
    }
  } finally {
    await Bun.file(preload).delete();
  }
});

testStable('diagram parser reports syntax errors and retains directive restrictions', async () => {
  expect((await Effect.runPromise(diagramFeedback('flowchart TD\nA["broken'))) ?? '').toMatch(
    /The flowchart needs fixing:/
  );
  assert.ok(
    (await Effect.runPromise(
      diagramFeedback('flowchart TD\nA --> B\nclick A "https://example.com"')
    )) === 'Use a flowchart TD or LR without directives, styles, or click handlers.'
  );
  assert.strictEqual(await Effect.runPromise(diagramFeedback('flowchart LR\nA --> B')), undefined);
});
