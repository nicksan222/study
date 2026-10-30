import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Preserve typed failures instead of converting them to defects with Effect.orDie or Effect.orDieWith.';

test('reports misuse and accepts scoped alternatives', () => {
  assertDiagnostics(
    'effect-no-or-die',
    lintRule('effect-no-or-die', {
      'src/procedures/bad.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.orDie(E.fail('bad'));",
      'src/procedures/good.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.catchTag('Missing', () => E.succeed(null)); function f(E: any) { E.orDie(1); }",
      'src/procedures/example.test.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.orDie(E.fail('bad'));"
    }),
    [['src/procedures/bad.ts', message]]
  );
});
test('resolves imported namespaces, named imports, const aliases and shadowing', () => {
  assertDiagnostics(
    'effect-no-or-die',
    lintRule('effect-no-or-die', {
      'src/procedures/aliases.ts':
        "import * as E from 'effect/Effect'; import { orDie as operation } from 'effect/Effect'; const alias = E; alias.orDie(E.void); operation(E.void); function f(E: any, operation: any) { E.orDie(E.void); operation(E.void); }"
    }),
    [
      ['src/procedures/aliases.ts', message],
      ['src/procedures/aliases.ts', message]
    ]
  );
});

test('enforces the Effect contract in browser operations', () => {
  const diagnostics = lintRule(
    'effect-no-or-die',
    {
      'apps/web/src/features/example/page.logic.ts':
        "import { Effect } from 'effect'; export const task = Effect.orDie(other);",
      'apps/web/src/features/example/page.logic.test.ts':
        "import { Effect } from 'effect'; export const task = Effect.orDie(other);"
    },
    true
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});
