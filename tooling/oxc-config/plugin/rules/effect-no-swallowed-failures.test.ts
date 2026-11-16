import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Handle or propagate Effect failures explicitly instead of silently discarding them.';

testStable('reports swallowed Effect failures and accepts explicit recovery', async () => {
  assertDiagnostics(
    'effect-no-swallowed-failures',
    await lintRule('effect-no-swallowed-failures', {
      'src/procedures/bad.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/server/shared/errors";
E.ignore(E.fail("bad"));
E.catch(() => E.void);
E.catchCause(() => E.succeed(undefined));`,
      'src/procedures/good.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/server/shared/errors";
E.catchTag("Missing", () => E.succeed(null));
E.catch((error) => E.fail(error));`,
      'src/procedures/example.test.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/server/shared/errors";
E.ignore(E.fail("bad"));
E.catch(() => E.void);
E.catchCause(() => E.succeed(undefined));`
    }),
    [
      ['src/procedures/bad.ts', message],
      ['src/procedures/bad.ts', message],
      ['src/procedures/bad.ts', message]
    ]
  );
});
testStable('resolves imported namespaces, named imports, const aliases and shadowing', async () => {
  assertDiagnostics(
    'effect-no-swallowed-failures',
    await lintRule('effect-no-swallowed-failures', {
      'src/procedures/aliases.ts': String.raw`import * as E from "effect/Effect";
import { ignore as operation } from "effect/Effect";
const alias = E;
alias.ignore(E.void);
operation(E.void);
function f(E: any, operation: any) {
  E.ignore(E.void);
  operation(E.void);
}`
    }),
    [
      ['src/procedures/aliases.ts', message],
      ['src/procedures/aliases.ts', message]
    ]
  );
});

testStable(
  'rejects silent statement blocks and allows explicit propagation and tagged recovery',
  async () => {
    assertDiagnostics(
      'effect-no-swallowed-failures',
      await lintRule('effect-no-swallowed-failures', {
        'src/procedures/catches.ts': String.raw`import { Effect as E } from "effect";
E.catch((error) => {
  const ignored = error;
  return E.void;
});
E.catchCause(() => {});
E.catch((error) => {
  log(error);
  return E.fail(error);
});
E.catch((error) => {
  log(error);
  throw error;
});
E.catchTag("Missing", () => E.succeed(null));`
      }),
      [
        ['src/procedures/catches.ts', message],
        ['src/procedures/catches.ts', message]
      ]
    );
  }
);

testStable('reports swallowed browser Effect failures and accepts explicit recovery', async () => {
  const diagnostics = await lintRule(
    'effect-no-swallowed-failures',
    {
      'apps/client/src/features/example/page.logic.ts':
        "import { Effect } from 'effect'; export const task = Effect.ignore(other);",
      'apps/client/src/features/example/page.logic.test.ts':
        "import { Effect } from 'effect'; export const task = Effect.ignore(other);"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable(
  'checks extracted recovery handlers without following mutable or shadowed functions',
  async () => {
    assertDiagnostics(
      'effect-no-swallowed-failures',
      await lintRule('effect-no-swallowed-failures', {
        'src/bad.ts': String.raw`import { Effect as E } from "effect";
const ignore = () => E.void;
const alias = ignore;
E.catch(alias);
function fallback() {
  return E.succeed(undefined);
}
E.catchCause(task, fallback);`,
        'src/good.ts': String.raw`import { Effect as E } from "effect";
const propagate = (error) => E.fail(error);
E.catch(propagate);
let mutable = () => E.void;
E.catch(mutable);
const ignore = () => E.void;
function f(ignore: any) {
  E.catch(ignore);
}
function same(same: any) {
  E.catch(same);
}`
      }),
      [
        ['src/bad.ts', message],
        ['src/bad.ts', message]
      ]
    );
  }
);

testStable('accepts explicit recovery values while rejecting discarded failures', async () => {
  assertDiagnostics(
    'effect-no-swallowed-failures',
    await lintRule('effect-no-swallowed-failures', {
      'src/recovery.ts': String.raw`import { Effect as E } from "effect";
E.catch((error) => E.succeed(error));
E.catch(() => E.succeed(null));
E.catch(() => E.succeed([]));
E.catch(() => E.succeed({ available: false }));
E.catch(() => E.succeed(undefined));
E.catch(() => E.succeed(void 0));`
    }),
    [
      ['src/recovery.ts', message],
      ['src/recovery.ts', message]
    ]
  );
});
