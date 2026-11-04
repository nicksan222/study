import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Use Effect.forkScoped so background fibers have an owning scope.';

testStable('reports unsafe server lifecycle syntax and permits bounded operations', () => {
  const diagnostics = lintRule('effect-scoped-fibers', {
    'src/workers/unsafe.ts': "import { Effect as E } from 'effect'; E.forkDetach(work);",
    'src/workers/safe.ts':
      "import * as E from 'effect/Effect'; E.forkScoped(work); function f(E) { E.forkDetach(work); }",
    'src/workers/unsafe.test.ts': "import { Effect as E } from 'effect'; E.forkDetach(work);",
    'client/browser.ts': "import { Effect as E } from 'effect'; E.forkDetach(work);"
  });

  assertDiagnostics('effect-scoped-fibers', diagnostics, [['src/workers/unsafe.ts', message]]);
});

testStable('tracks namespace, named and const aliases', () => {
  const diagnostics = lintRule('effect-scoped-fibers', {
    'src/workers/example.ts':
      "import * as E from 'effect/Effect'; import { forkDetach as detach } from 'effect/Effect'; const run = E.forkDetach; run(work); detach(work);"
  });

  assertDiagnostics('effect-scoped-fibers', diagnostics, [
    ['src/workers/example.ts', message],
    ['src/workers/example.ts', message]
  ]);
});

testStable('permits only the explicit application root', () => {
  const diagnostics = lintRule('effect-scoped-fibers', {
    'src/runtime/main.ts': "import { Effect } from 'effect'; Effect.forkDetach(work);"
  });

  assertDiagnostics('effect-scoped-fibers', diagnostics, []);
});

testStable('retains enforcement in other runtime modules', () => {
  const diagnostics = lintRule('effect-scoped-fibers', {
    'src/runtime/service.ts': "import { Effect } from 'effect'; Effect.forkDetach(work);"
  });

  assertDiagnostics('effect-scoped-fibers', diagnostics, [['src/runtime/service.ts', message]]);
});

testStable('tracks destructured aliases and ignores their local shadows', () => {
  const diagnostics = lintRule('effect-scoped-fibers', {
    'src/workers/destructure.ts':
      "import { Effect as E } from 'effect'; const { forkDetach: detach } = E; detach(work); function f(detach) { detach(work); }"
  });

  assertDiagnostics('effect-scoped-fibers', diagnostics, [['src/workers/destructure.ts', message]]);
});

testStable('enforces the Effect contract in browser operations', () => {
  const diagnostics = lintRule(
    'effect-scoped-fibers',
    {
      'apps/web/src/features/example/page.logic.ts':
        "import { Effect } from 'effect'; export const task = Effect.forkDetach(other);",
      'apps/web/src/features/example/page.logic.test.ts':
        "import { Effect } from 'effect'; export const task = Effect.forkDetach(other);"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('rejects inline scopes without a retained owner in both forkIn forms', () => {
  const diagnostics = lintRule('effect-scoped-fibers', {
    'src/bad.ts':
      "import {Effect, Scope} from 'effect'; Effect.forkIn(work, Scope.makeUnsafe()); Effect.forkIn(Scope.makeUnsafe())(work);",
    'src/aliases.ts':
      "import {forkIn} from 'effect/Effect'; import {makeUnsafe as scope} from 'effect/Scope'; forkIn(work, scope());",
    'src/good.ts':
      "import {Effect, Scope} from 'effect'; const owned = Scope.makeUnsafe(); Effect.forkIn(work, owned); Effect.forkIn(owned)(work); Effect.forkScoped(work); function f(Scope: any) { Effect.forkIn(work, Scope.makeUnsafe()); }"
  });

  assertDiagnostics('effect-scoped-fibers', diagnostics, [
    ['src/bad.ts', message],
    ['src/bad.ts', message],
    ['src/aliases.ts', message]
  ]);
});
