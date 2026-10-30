import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Use Effect.sleep or a scoped Effect schedule instead of native timers in application operations.';

test('reports unsafe server lifecycle syntax and permits bounded operations', () => {
  const diagnostics = lintRule('effect-no-native-timers', {
    'src/workers/unsafe.ts': 'setTimeout(work, 100);',
    'src/workers/safe.ts': 'function f(setTimeout) { setTimeout(work, 100); }',
    'src/workers/unsafe.test.ts': 'setTimeout(work, 100);',
    'client/browser.ts': 'setTimeout(work, 100);'
  });

  assertDiagnostics('effect-no-native-timers', diagnostics, [['src/workers/unsafe.ts', message]]);
});

test('rejects imported timers and global aliases', () => {
  const diagnostics = lintRule('effect-no-native-timers', {
    'src/workers/example.ts':
      "import { setTimeout as later } from 'node:timers'; const tick = globalThis.setInterval; tick(work, 10);"
  });

  assertDiagnostics('effect-no-native-timers', diagnostics, [
    ['src/workers/example.ts', message],
    ['src/workers/example.ts', message]
  ]);
});

test('permits the native callback transport adapter', () => {
  const diagnostics = lintRule('effect-no-native-timers', {
    'src/runtime/server.ts': "import { setTimeout } from 'node:timers'; setTimeout(work, 1);"
  });

  assertDiagnostics('effect-no-native-timers', diagnostics, []);
});

test('ignores unrelated methods and shadowed globals', () => {
  const diagnostics = lintRule('effect-no-native-timers', {
    'src/workers/example.ts':
      'function f(globalThis) { globalThis.setTimeout(work, 1); } const other = { setTimeout() {} }; other.setTimeout();'
  });

  assertDiagnostics('effect-no-native-timers', diagnostics, []);
});

test('rejects native abort deadlines while preserving cancellation composition', () => {
  const diagnostics = lintRule('effect-no-native-timers', {
    'src/platform/ai/providers/example.ts': `
      AbortSignal.timeout(1000);
      const deadline = globalThis.AbortSignal.timeout;
      deadline(1000);
      const { timeout: expire } = AbortSignal;
      expire(1000);
      AbortSignal.any([signal]);
      function local(AbortSignal) { AbortSignal.timeout(1000); }
      const transport = { timeout(ms) {} };
      transport.timeout(1000);
    `
  });

  assertDiagnostics('effect-no-native-timers', diagnostics, [
    ['src/platform/ai/providers/example.ts', message],
    ['src/platform/ai/providers/example.ts', message],
    ['src/platform/ai/providers/example.ts', message]
  ]);
});

test('enforces the Effect contract in browser operations', () => {
  const diagnostics = lintRule(
    'effect-no-native-timers',
    {
      'apps/web/src/features/example/page.logic.ts':
        'export const task = setTimeout(() => {}, 10);',
      'apps/web/src/features/example/page.logic.test.ts':
        'export const task = setTimeout(() => {}, 10);'
    },
    true
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('allows a debounce timeout owned by a React hook effect', () => {
  assert.deepEqual(
    lintRule(
      'effect-no-native-timers',
      {
        'apps/web/src/app/shell/use-sidebar.ts': `
      import { useEffect as effect } from 'react';
      effect(() => {
        const timer = setTimeout(updateSearch, 200);
        return () => clearTimeout(timer);
      }, [query]);
    `
      },
      true
    ),
    []
  );
});
