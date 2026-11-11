import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Pass the Effect.tryPromise cancellation signal to fetch.';

testStable('reports unsafe server lifecycle syntax and permits bounded operations', async () => {
  const diagnostics = await lintRule('effect-abort-signal', {
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

testStable('finds fetch aliases in object callbacks and return bodies', async () => {
  const diagnostics = await lintRule('effect-abort-signal', {
    'src/workers/example.ts':
      "import { tryPromise as attempt } from 'effect/Effect'; import { fetch as request } from 'undici'; const native = fetch; attempt({ try: () => { return request(url); }, catch: error => error }); attempt(() => native(url));"
  });

  assertDiagnostics('effect-abort-signal', diagnostics, [
    ['src/workers/example.ts', message],
    ['src/workers/example.ts', message]
  ]);
});

testStable('accepts object callbacks and native fetch aliases with signal', async () => {
  const diagnostics = await lintRule('effect-abort-signal', {
    'src/workers/example.ts':
      "import * as E from 'effect/Effect'; const request = globalThis.fetch; E.tryPromise({ try: signal => request(url, { signal }), catch: error => error });"
  });

  assertDiagnostics('effect-abort-signal', diagnostics, []);
});

testStable('ignores unrelated or shadowed fetch APIs', async () => {
  const diagnostics = await lintRule('effect-abort-signal', {
    'src/workers/example.ts':
      "import { Effect } from 'effect'; function f(fetch) { return Effect.tryPromise(() => fetch(url)); } Effect.tryPromise(() => other.fetch(url));"
  });

  assertDiagnostics('effect-abort-signal', diagnostics, []);
});

testStable('rejects a signal from an unrelated variable', async () => {
  const diagnostics = await lintRule('effect-abort-signal', {
    'src/workers/example.ts':
      "import { Effect } from 'effect'; const other = new AbortController(); Effect.tryPromise(signal => fetch(url, { signal: other.signal }));"
  });

  assertDiagnostics('effect-abort-signal', diagnostics, [['src/workers/example.ts', message]]);
});

testStable('enforces the Effect contract in browser operations', async () => {
  const diagnostics = await lintRule(
    'effect-abort-signal',
    {
      'apps/web/src/features/example/page.logic.ts':
        "import { Effect } from 'effect'; export const task = Effect.tryPromise(() => fetch(url));",
      'apps/web/src/features/example/page.logic.test.ts':
        "import { Effect } from 'effect'; export const task = Effect.tryPromise(() => fetch(url));"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('propagates the signal from native callback bridges', async () => {
  assertDiagnostics(
    'effect-abort-signal',
    await lintRule('effect-abort-signal', {
      'src/bad.ts':
        "import {Effect as E} from 'effect'; E.callback((resume, signal) => { fetch(url); }); E.callback((resume, signal) => { fetch(url, {signal: other}); });",
      'src/good.ts':
        "import {Effect as E} from 'effect'; E.callback((resume, signal) => { fetch(url, {signal}); }); E.callback(resume => { otherWork(resume); }); function f(E: any) { E.callback(() => fetch(url)); }"
    }),
    [
      ['src/bad.ts', 'Pass the Effect.callback cancellation signal to fetch.'],
      ['src/bad.ts', 'Pass the Effect.callback cancellation signal to fetch.']
    ]
  );
});

testStable('retains cancellation checks for extracted bridge callbacks', async () => {
  assertDiagnostics(
    'effect-abort-signal',
    await lintRule('effect-abort-signal', {
      'src/bad.ts':
        "import {Effect} from 'effect'; const request = signal => fetch(url); Effect.tryPromise(request);",
      'src/good.ts':
        "import {Effect} from 'effect'; const request = signal => fetch(url, {signal}); Effect.tryPromise(request);"
    }),
    [['src/bad.ts', 'Pass the Effect.tryPromise cancellation signal to fetch.']]
  );
});

testStable('attributes nested fetches to their nearest native cancellation bridge', async () => {
  assertDiagnostics(
    'effect-abort-signal',
    await lintRule('effect-abort-signal', {
      'src/good.ts':
        "import {Effect as E} from 'effect'; E.callback(resume => { resume(E.tryPromise(signal => fetch(url, {signal}))); }); E.callback(resume => { const inner = signal => fetch(url, {signal}); resume(E.tryPromise(inner)); });",
      'src/bad.ts':
        "import {Effect as E} from 'effect'; E.callback(resume => { resume(E.tryPromise(signal => fetch(url))); });"
    }),
    [['src/bad.ts', message]]
  );
});
