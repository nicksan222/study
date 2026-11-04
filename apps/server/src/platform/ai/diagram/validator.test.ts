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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { diagramFeedback } from './validator.ts';

const execute = promisify(execFile);

testStable('diagram parser does not inherit application preloads', async () => {
  const preload = `import { isMainThread } from 'node:worker_threads';
    if (!isMainThread) throw new Error('Application preload ran in the diagram worker');`;
  const validator = new URL('./validator.ts', import.meta.url).href;
  const script = `Promise.all([import('effect'), import(${JSON.stringify(validator)})])
    .then(async ([{ Effect }, { diagramFeedback }]) => {
      const result = await Effect.runPromise(diagramFeedback('flowchart TD\\nA["alpha"] --> B["beta"]'));
      if (result !== undefined) throw new Error(result);
    }).catch(error => { console.error(error); process.exitCode = 1; });`;
  const result = await execute(
    process.execPath,
    [`--import=data:text/javascript,${encodeURIComponent(preload)}`, '--eval', script],
    { timeout: 30000 }
  );

  assert.ok(result.stderr === '');
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
