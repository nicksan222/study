import { test } from '@study/testing';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Use a finite positive concurrency limit for variable Effect batches.';

test.unit.stable(
  'requires bounded concurrency for server batches',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-bounded-concurrency', {
      'src/workers/unsafe.ts': String.raw`import { Effect as E } from "effect";
E.forEach(items, work, { concurrency: "unbounded" });`,
      'src/workers/safe.ts': String.raw`import { Effect as E } from "effect";
E.forEach(items, work);
E.all(items, { concurrency: 4 });
E.all([a, b], { concurrency: "unbounded" });`,
      'src/workers/unsafe.test.ts': String.raw`import { Effect as E } from "effect";
E.forEach(items, work, { concurrency: "unbounded" });`,
      'client/browser.ts': String.raw`import { Effect as E } from "effect";
E.forEach(items, work, { concurrency: "unbounded" });`
    });

    assertDiagnostics({ assert, expect }, 'effect-bounded-concurrency', diagnostics, [
      ['src/workers/unsafe.ts', message]
    ]);
  }
);

test.unit.stable(
  'tracks named imports and rejects opaque limits and curried unbounded batches',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-bounded-concurrency', {
      'src/workers/example.ts': String.raw`import { forEach as each, all as collect } from "effect/Effect";
each(work, { concurrency: "unbounded" });
collect(items, { concurrency: count });`
    });

    assertDiagnostics({ assert, expect }, 'effect-bounded-concurrency', diagnostics, [
      ['src/workers/example.ts', message],
      ['src/workers/example.ts', message]
    ]);
  }
);

test.unit.stable(
  'ignores shadowed APIs and accepts literal record batches',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-bounded-concurrency', {
      'src/workers/example.ts': String.raw`import { Effect as E } from "effect";
E.all({ a, b }, { concurrency: "unbounded" });
function f(E) {
  E.all(items, { concurrency: "unbounded" });
}`
    });

    assertDiagnostics({ assert, expect }, 'effect-bounded-concurrency', diagnostics, []);
  }
);

test.unit.stable(
  'rejects invalid numeric limits and spread batches',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-bounded-concurrency', {
      'src/workers/example.ts': String.raw`import * as E from "effect/Effect";
E.all([...items], { concurrency: Infinity });
E.forEach(items, work, { concurrency: 0 });`
    });

    assertDiagnostics({ assert, expect }, 'effect-bounded-concurrency', diagnostics, [
      ['src/workers/example.ts', message],
      ['src/workers/example.ts', message]
    ]);
  }
);

test.unit.stable(
  'requires bounded concurrency for browser Effect batches',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'effect-bounded-concurrency',
      {
        'apps/client/src/features/example/page.logic.ts': String.raw`import { Effect } from "effect";
export const task = Effect.forEach(items, f, { concurrency: "unbounded" });`,
        'apps/client/src/features/example/page.logic.test.ts': String.raw`import { Effect } from "effect";
export const task = Effect.forEach(items, f, { concurrency: "unbounded" });`
      },
      true
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);
