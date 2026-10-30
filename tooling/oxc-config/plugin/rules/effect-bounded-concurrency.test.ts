import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Use a finite positive concurrency limit for variable Effect batches.';

test('reports unsafe server lifecycle syntax and permits bounded operations', () => {
  const diagnostics = lintRule('effect-bounded-concurrency', {
    'src/workers/unsafe.ts':
      "import { Effect as E } from 'effect'; E.forEach(items, work, { concurrency: 'unbounded' });",
    'src/workers/safe.ts':
      "import { Effect as E } from 'effect'; E.forEach(items, work); E.all(items, { concurrency: 4 }); E.all([a, b], { concurrency: 'unbounded' });",
    'src/workers/unsafe.test.ts':
      "import { Effect as E } from 'effect'; E.forEach(items, work, { concurrency: 'unbounded' });",
    'client/browser.ts':
      "import { Effect as E } from 'effect'; E.forEach(items, work, { concurrency: 'unbounded' });"
  });

  assertDiagnostics('effect-bounded-concurrency', diagnostics, [
    ['src/workers/unsafe.ts', message]
  ]);
});

test('tracks named imports and rejects opaque limits and curried unbounded batches', () => {
  const diagnostics = lintRule('effect-bounded-concurrency', {
    'src/workers/example.ts':
      "import { forEach as each, all as collect } from 'effect/Effect'; each(work, { concurrency: 'unbounded' }); collect(items, { concurrency: count });"
  });

  assertDiagnostics('effect-bounded-concurrency', diagnostics, [
    ['src/workers/example.ts', message],
    ['src/workers/example.ts', message]
  ]);
});

test('ignores shadowed APIs and accepts literal record batches', () => {
  const diagnostics = lintRule('effect-bounded-concurrency', {
    'src/workers/example.ts':
      "import { Effect as E } from 'effect'; E.all({ a, b }, { concurrency: 'unbounded' }); function f(E) { E.all(items, { concurrency: 'unbounded' }); }"
  });

  assertDiagnostics('effect-bounded-concurrency', diagnostics, []);
});

test('rejects invalid numeric limits and spread batches', () => {
  const diagnostics = lintRule('effect-bounded-concurrency', {
    'src/workers/example.ts':
      "import * as E from 'effect/Effect'; E.all([...items], { concurrency: Infinity }); E.forEach(items, work, { concurrency: 0 });"
  });

  assertDiagnostics('effect-bounded-concurrency', diagnostics, [
    ['src/workers/example.ts', message],
    ['src/workers/example.ts', message]
  ]);
});

test('enforces the Effect contract in browser operations', () => {
  const diagnostics = lintRule(
    'effect-bounded-concurrency',
    {
      'apps/web/src/features/example/page.logic.ts':
        "import { Effect } from 'effect'; export const task = Effect.forEach(items, f, { concurrency: 'unbounded' });",
      'apps/web/src/features/example/page.logic.test.ts':
        "import { Effect } from 'effect'; export const task = Effect.forEach(items, f, { concurrency: 'unbounded' });"
    },
    true
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});
