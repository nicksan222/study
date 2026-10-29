import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Pass the Effect.tryPromise cancellation signal to fetch.';

test('reports unsafe server lifecycle syntax and permits bounded operations', () => {
  const diagnostics = lintRule('effect-abort-signal', {
    'src/workers/unsafe.ts':
      "import { Effect as E } from 'effect'; E.tryPromise(() => fetch(url));",
    'src/workers/safe.ts':
      "import { Effect as E } from 'effect'; E.tryPromise(signal => fetch(url, { signal })); E.tryPromise(() => arbitraryPromise());",
    'src/workers/unsafe.test.ts':
      "import { Effect as E } from 'effect'; E.tryPromise(() => fetch(url));",
    'client/browser.ts': "import { Effect as E } from 'effect'; E.tryPromise(() => fetch(url));"
  });

  assertDiagnostics('effect-abort-signal', diagnostics, [['src/workers/unsafe.ts', message]]);
});

test('finds fetch aliases in object callbacks and return bodies', () => {
  const diagnostics = lintRule('effect-abort-signal', {
    'src/workers/example.ts':
      "import { tryPromise as attempt } from 'effect/Effect'; import { fetch as request } from 'undici'; const native = fetch; attempt({ try: () => { return request(url); }, catch: error => error }); attempt(() => native(url));"
  });

  assertDiagnostics('effect-abort-signal', diagnostics, [
    ['src/workers/example.ts', message],
    ['src/workers/example.ts', message]
  ]);
});

test('accepts object callbacks and native fetch aliases with signal', () => {
  const diagnostics = lintRule('effect-abort-signal', {
    'src/workers/example.ts':
      "import * as E from 'effect/Effect'; const request = globalThis.fetch; E.tryPromise({ try: signal => request(url, { signal }), catch: error => error });"
  });

  assertDiagnostics('effect-abort-signal', diagnostics, []);
});

test('ignores unrelated or shadowed fetch APIs', () => {
  const diagnostics = lintRule('effect-abort-signal', {
    'src/workers/example.ts':
      "import { Effect } from 'effect'; function f(fetch) { return Effect.tryPromise(() => fetch(url)); } Effect.tryPromise(() => other.fetch(url));"
  });

  assertDiagnostics('effect-abort-signal', diagnostics, []);
});

test('rejects a signal from an unrelated variable', () => {
  const diagnostics = lintRule('effect-abort-signal', {
    'src/workers/example.ts':
      "import { Effect } from 'effect'; const other = new AbortController(); Effect.tryPromise(signal => fetch(url, { signal: other.signal }));"
  });

  assertDiagnostics('effect-abort-signal', diagnostics, [['src/workers/example.ts', message]]);
});
