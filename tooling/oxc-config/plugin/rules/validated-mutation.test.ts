import { test } from '@study/testing';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

test.unit.stable(
  'schema-validated transaction branches use the shared mutation harness',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'validated-mutation',
      await lintRule({ assert }, 'validated-mutation', {
        'src/features/settings/service/bad.ts': String.raw`import { Effect as E, Schema as S } from "effect";
import { transaction as tx } from "#server/platform/definitions/define-store";
export const save = (input) => (!S.is(schema)(input) ? E.fail(error) : tx(write));`,
        'src/features/settings/service/good.ts': String.raw`import { Effect, Schema } from "effect";
import { transaction } from "#server/platform/definitions/define-store";
export const check = (input) => (Schema.is(schema)(input) ? input : fallback);
export const save = (input) => (allowed(input) ? transaction(write) : Effect.fail(error));`
      }),
      [
        [
          'src/features/settings/service/bad.ts',
          'Use validatedMutation instead of repeating schema validation and transaction branches.'
        ]
      ]
    );
  }
);
