import { test } from '@study/testing';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Bound retries with a finite times count or a bounded Schedule.recurs; use a bounded helper for opaque schedules.';

test.unit.stable(
  'keeps retries within the bounded server retry policy',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-bounded-retries', {
      'src/workers/unsafe.ts': "import { Effect as E } from 'effect'; E.retry(work, policy);",
      'src/workers/safe.ts': String.raw`import { Effect as E, Schedule as S } from "effect";
E.retry(work, { times: 3 });
E.retry(work, S.recurs(4));`,
      'src/workers/unsafe.test.ts': "import { Effect as E } from 'effect'; E.retry(work, policy);",
      'client/browser.ts': "import { Effect as E } from 'effect'; E.retry(work, policy);"
    });

    assertDiagnostics({ assert, expect }, 'effect-bounded-retries', diagnostics, [
      ['src/workers/unsafe.ts', message]
    ]);
  }
);

test.unit.stable(
  'tracks named and namespace aliases and rejects infinite policies',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-bounded-retries', {
      'src/workers/example.ts': String.raw`import { retry as again } from "effect/Effect";
import * as S from "effect/Schedule";
again(work, S.forever);
again({ schedule: S.exponential("1 second") });`
    });

    assertDiagnostics({ assert, expect }, 'effect-bounded-retries', diagnostics, [
      ['src/workers/example.ts', message],
      ['src/workers/example.ts', message]
    ]);
  }
);

test.unit.stable(
  'accepts options and v4 intersection schedules',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-bounded-retries', {
      'src/workers/example.ts': String.raw`import { Effect as E, Schedule as S } from "effect";
E.retry(work, { schedule: S.recurs(2) });
E.retry(work, S.max([S.exponential("1 second"), S.recurs(3)]));
E.retry(work, S.min([S.recurs(1), S.recurs(2)]));`
    });

    assertDiagnostics({ assert, expect }, 'effect-bounded-retries', diagnostics, []);
  }
);

test.unit.stable(
  'does not prove runtime schedules or union with an unbounded branch',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-bounded-retries', {
      'src/workers/example.ts': String.raw`import { Effect as E, Schedule as S } from "effect";
E.retry(work, S.recurs(limit));
E.retry(work, S.min([S.forever, S.recurs(2)]));`
    });

    assertDiagnostics({ assert, expect }, 'effect-bounded-retries', diagnostics, [
      ['src/workers/example.ts', message],
      ['src/workers/example.ts', message]
    ]);
  }
);

test.unit.stable(
  'ignores shadowed and unrelated retry methods',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-bounded-retries', {
      'src/workers/example.ts': String.raw`import { Effect as E } from "effect";
function f(E) {
  E.retry(work, policy);
}
other.retry(work, policy);`
    });

    assertDiagnostics({ assert, expect }, 'effect-bounded-retries', diagnostics, []);
  }
);

test.unit.stable(
  'does not assume an opaque schedule transformation preserves its bound',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-bounded-retries', {
      'src/workers/opaque.ts': String.raw`import { Effect as E, Schedule as S } from "effect";
E.retry(work, S.recurs(2).pipe(transform));
E.retry(work, S.recurs(2).pipe(S.union(S.forever)));`
    });

    assertDiagnostics({ assert, expect }, 'effect-bounded-retries', diagnostics, [
      ['src/workers/opaque.ts', message],
      ['src/workers/opaque.ts', message]
    ]);
  }
);

test.unit.stable(
  'keeps browser Effect retries within the bounded retry policy',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'effect-bounded-retries',
      {
        'apps/client/src/features/example/page.logic.ts':
          "import { Effect } from 'effect'; export const task = Effect.retry(other);",
        'apps/client/src/features/example/page.logic.test.ts':
          "import { Effect } from 'effect'; export const task = Effect.retry(other);"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);
