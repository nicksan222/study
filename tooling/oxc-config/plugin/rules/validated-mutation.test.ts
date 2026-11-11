import { testStable } from '@study/testing/vitest';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

testStable('schema-validated transaction branches use the shared mutation harness', async () => {
  assertDiagnostics(
    'validated-mutation',
    await lintRule('validated-mutation', {
      'src/features/settings/service/bad.ts':
        "import {Effect as E, Schema as S} from 'effect'; import {transaction as tx} from '#server/platform/definitions/define-store'; export const save = input => !S.is(schema)(input) ? E.fail(error) : tx(write);",
      'src/features/settings/service/good.ts':
        "import {Effect, Schema} from 'effect'; import {transaction} from '#server/platform/definitions/define-store'; export const check = input => Schema.is(schema)(input) ? input : fallback; export const save = input => allowed(input) ? transaction(write) : Effect.fail(error);"
    }),
    [
      [
        'src/features/settings/service/bad.ts',
        'Use validatedMutation instead of repeating schema validation and transaction branches.'
      ]
    ]
  );
});
