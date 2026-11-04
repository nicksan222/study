import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Handle or propagate Effect failures explicitly instead of silently discarding them.';

testStable('reports misuse and accepts scoped alternatives', () => {
  assertDiagnostics(
    'effect-no-swallowed-failures',
    lintRule('effect-no-swallowed-failures', {
      'src/procedures/bad.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.ignore(E.fail('bad')); E.catch(() => E.void); E.catchCause(() => E.succeed(null));",
      'src/procedures/good.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.catchTag('Missing', () => E.succeed(null)); E.catch(error => E.fail(error));",
      'src/procedures/example.test.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.ignore(E.fail('bad')); E.catch(() => E.void); E.catchCause(() => E.succeed(null));"
    }),
    [
      ['src/procedures/bad.ts', message],
      ['src/procedures/bad.ts', message],
      ['src/procedures/bad.ts', message]
    ]
  );
});
testStable('resolves imported namespaces, named imports, const aliases and shadowing', () => {
  assertDiagnostics(
    'effect-no-swallowed-failures',
    lintRule('effect-no-swallowed-failures', {
      'src/procedures/aliases.ts':
        "import * as E from 'effect/Effect'; import { ignore as operation } from 'effect/Effect'; const alias = E; alias.ignore(E.void); operation(E.void); function f(E: any, operation: any) { E.ignore(E.void); operation(E.void); }"
    }),
    [
      ['src/procedures/aliases.ts', message],
      ['src/procedures/aliases.ts', message]
    ]
  );
});

testStable(
  'rejects silent statement blocks and allows explicit propagation and tagged recovery',
  () => {
    assertDiagnostics(
      'effect-no-swallowed-failures',
      lintRule('effect-no-swallowed-failures', {
        'src/procedures/catches.ts':
          "import {Effect as E} from 'effect'; E.catch(error => { const ignored = error; return E.void; }); E.catchCause(() => {}); E.catch(error => { log(error); return E.fail(error); }); E.catch(error => { log(error); throw error; }); E.catchTag('Missing', () => E.succeed(null));"
      }),
      [
        ['src/procedures/catches.ts', message],
        ['src/procedures/catches.ts', message]
      ]
    );
  }
);

testStable('enforces the Effect contract in browser operations', () => {
  const diagnostics = lintRule(
    'effect-no-swallowed-failures',
    {
      'apps/web/src/features/example/page.logic.ts':
        "import { Effect } from 'effect'; export const task = Effect.ignore(other);",
      'apps/web/src/features/example/page.logic.test.ts':
        "import { Effect } from 'effect'; export const task = Effect.ignore(other);"
    },
    true
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable(
  'checks extracted recovery handlers without following mutable or shadowed functions',
  () => {
    assertDiagnostics(
      'effect-no-swallowed-failures',
      lintRule('effect-no-swallowed-failures', {
        'src/bad.ts':
          "import {Effect as E} from 'effect'; const ignore = () => E.void; const alias = ignore; E.catch(alias); function fallback() { return E.succeed(null); } E.catchCause(task, fallback);",
        'src/good.ts':
          "import {Effect as E} from 'effect'; const propagate = error => E.fail(error); E.catch(propagate); let mutable = () => E.void; E.catch(mutable); const ignore = () => E.void; function f(ignore: any) { E.catch(ignore); } function same(same: any) { E.catch(same); }"
      }),
      [
        ['src/bad.ts', message],
        ['src/bad.ts', message]
      ]
    );
  }
);
