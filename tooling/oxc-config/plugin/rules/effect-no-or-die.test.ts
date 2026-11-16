import { test } from '@study/testing';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Preserve typed failures instead of converting them to defects with Effect.orDie or Effect.orDieWith.';

test.stable('reports unsafe Effect.orDie calls and accepts typed failures', async () => {
  assertDiagnostics(
    'effect-no-or-die',
    await lintRule('effect-no-or-die', {
      'src/procedures/bad.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/server/shared/errors";
E.orDie(E.fail("bad"));`,
      'src/procedures/good.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/server/shared/errors";
E.catchTag("Missing", () => E.succeed(null));
function f(E: any) {
  E.orDie(1);
}`,
      'src/procedures/example.test.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/server/shared/errors";
E.orDie(E.fail("bad"));`
    }),
    [['src/procedures/bad.ts', message]]
  );
});
test.stable(
  'resolves imported namespaces, named imports, const aliases and shadowing',
  async () => {
    assertDiagnostics(
      'effect-no-or-die',
      await lintRule('effect-no-or-die', {
        'src/procedures/aliases.ts': String.raw`import * as E from "effect/Effect";
import { orDie as operation } from "effect/Effect";
const alias = E;
alias.orDie(E.void);
operation(E.void);
function f(E: any, operation: any) {
  E.orDie(E.void);
  operation(E.void);
}`
      }),
      [
        ['src/procedures/aliases.ts', message],
        ['src/procedures/aliases.ts', message]
      ]
    );
  }
);

test.stable('keeps browser failures typed instead of calling Effect.orDie', async () => {
  const diagnostics = await lintRule(
    'effect-no-or-die',
    {
      'apps/client/src/features/example/page.logic.ts':
        "import { Effect } from 'effect'; export const task = Effect.orDie(other);",
      'apps/client/src/features/example/page.logic.test.ts':
        "import { Effect } from 'effect'; export const task = Effect.orDie(other);"
    },
    true
  );

  test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});
