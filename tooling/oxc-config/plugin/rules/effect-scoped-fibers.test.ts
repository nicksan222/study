import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Use Effect.forkScoped so background fibers have an owning scope.';

test('reports unsafe server lifecycle syntax and permits bounded operations', () => {
  const diagnostics = lintRule('effect-scoped-fibers', {
    'src/workers/unsafe.ts': "import { Effect as E } from 'effect'; E.forkDetach(work);",
    'src/workers/safe.ts':
      "import * as E from 'effect/Effect'; E.forkScoped(work); function f(E) { E.forkDetach(work); }",
    'src/workers/unsafe.test.ts': "import { Effect as E } from 'effect'; E.forkDetach(work);",
    'client/browser.ts': "import { Effect as E } from 'effect'; E.forkDetach(work);"
  });

  assertDiagnostics('effect-scoped-fibers', diagnostics, [['src/workers/unsafe.ts', message]]);
});

test('tracks namespace, named and const aliases', () => {
  const diagnostics = lintRule('effect-scoped-fibers', {
    'src/workers/example.ts':
      "import * as E from 'effect/Effect'; import { forkDetach as detach } from 'effect/Effect'; const run = E.forkDetach; run(work); detach(work);"
  });

  assertDiagnostics('effect-scoped-fibers', diagnostics, [
    ['src/workers/example.ts', message],
    ['src/workers/example.ts', message]
  ]);
});

test('permits only the explicit application root', () => {
  const diagnostics = lintRule('effect-scoped-fibers', {
    'src/runtime/main.ts': "import { Effect } from 'effect'; Effect.forkDetach(work);"
  });

  assertDiagnostics('effect-scoped-fibers', diagnostics, []);
});

test('retains enforcement in other runtime modules', () => {
  const diagnostics = lintRule('effect-scoped-fibers', {
    'src/runtime/service.ts': "import { Effect } from 'effect'; Effect.forkDetach(work);"
  });

  assertDiagnostics('effect-scoped-fibers', diagnostics, [['src/runtime/service.ts', message]]);
});

test('tracks destructured aliases and ignores their local shadows', () => {
  const diagnostics = lintRule('effect-scoped-fibers', {
    'src/workers/destructure.ts':
      "import { Effect as E } from 'effect'; const { forkDetach: detach } = E; detach(work); function f(detach) { detach(work); }"
  });

  assertDiagnostics('effect-scoped-fibers', diagnostics, [['src/workers/destructure.ts', message]]);
});
