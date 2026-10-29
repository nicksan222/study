import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Use Effect.tryPromise to preserve fallible promise failures in the typed error channel.';

test('reports misuse and accepts scoped alternatives', () => {
  assertDiagnostics(
    'effect-try-promise',
    lintRule('effect-try-promise', {
      'src/procedures/bad.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.promise(() => fetch('/'));",
      'src/procedures/good.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.tryPromise({ try: () => fetch('/'), catch: error => error }); function f(E: any) { E.promise(() => 1); }",
      'src/procedures/example.test.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.promise(() => fetch('/'));"
    }),
    [['src/procedures/bad.ts', message]]
  );
});
test('resolves imported namespaces, named imports, const aliases and shadowing', () => {
  assertDiagnostics(
    'effect-try-promise',
    lintRule('effect-try-promise', {
      'src/procedures/aliases.ts':
        "import * as E from 'effect/Effect'; import { promise as operation } from 'effect/Effect'; const alias = E; alias.promise(() => Promise.resolve(1)); operation(() => Promise.resolve(1)); function f(E: any, operation: any) { E.promise(() => Promise.resolve(1)); operation(() => Promise.resolve(1)); }"
    }),
    [
      ['src/procedures/aliases.ts', message],
      ['src/procedures/aliases.ts', message]
    ]
  );
});

test('resolves destructured constants and nested namespaces with shadowing', () => {
  assertDiagnostics(
    'effect-try-promise',
    lintRule('effect-try-promise', {
      'src/procedures/destructure.ts':
        "import * as Root from 'effect'; const {Effect: {promise: unsafe}} = Root; unsafe(() => Promise.resolve(1)); function f(unsafe: any) { unsafe(() => 1); }"
    }),
    [['src/procedures/destructure.ts', message]]
  );
});
