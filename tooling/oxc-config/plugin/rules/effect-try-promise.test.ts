import { test } from '@study/testing';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Use Effect.tryPromise to preserve fallible promise failures in the typed error channel.';

test.stable(
  'requires Effect.tryPromise for promise failures and accepts typed mapping',
  async () => {
    assertDiagnostics(
      'effect-try-promise',
      await lintRule('effect-try-promise', {
        'src/procedures/bad.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/server/shared/errors";
E.promise(() => fetch("/"));`,
        'src/procedures/good.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/server/shared/errors";
E.tryPromise({ try: () => fetch("/"), catch: (error) => error });
function f(E: any) {
  E.promise(() => 1);
}`,
        'src/procedures/example.test.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/server/shared/errors";
E.promise(() => fetch("/"));`
      }),
      [['src/procedures/bad.ts', message]]
    );
  }
);
test.stable(
  'resolves imported namespaces, named imports, const aliases and shadowing',
  async () => {
    assertDiagnostics(
      'effect-try-promise',
      await lintRule('effect-try-promise', {
        'src/procedures/aliases.ts': String.raw`import * as E from "effect/Effect";
import { promise as operation } from "effect/Effect";
const alias = E;
alias.promise(() => Promise.resolve(1));
operation(() => Promise.resolve(1));
function f(E: any, operation: any) {
  E.promise(() => Promise.resolve(1));
  operation(() => Promise.resolve(1));
}`
      }),
      [
        ['src/procedures/aliases.ts', message],
        ['src/procedures/aliases.ts', message]
      ]
    );
  }
);

test.stable('resolves destructured constants and nested namespaces with shadowing', async () => {
  assertDiagnostics(
    'effect-try-promise',
    await lintRule('effect-try-promise', {
      'src/procedures/destructure.ts': String.raw`import * as Root from "effect";
const {
  Effect: { promise: unsafe },
} = Root;
unsafe(() => Promise.resolve(1));
function f(unsafe: any) {
  unsafe(() => 1);
}`
    }),
    [['src/procedures/destructure.ts', message]]
  );
});

test.stable('requires browser promise failures to use Effect.tryPromise', async () => {
  const diagnostics = await lintRule(
    'effect-try-promise',
    {
      'apps/client/src/features/example/page.logic.ts': String.raw`import { Effect } from "effect";
export const task = Effect.promise(() => Promise.reject("bad"));`,
      'apps/client/src/features/example/page.logic.test.ts': String.raw`import { Effect } from "effect";
export const task = Effect.promise(() => Promise.reject("bad"));`
    },
    true
  );

  test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});
