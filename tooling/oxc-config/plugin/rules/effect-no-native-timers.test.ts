import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Use Effect.sleep or a scoped Effect schedule instead of native timers in server business code.';

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
