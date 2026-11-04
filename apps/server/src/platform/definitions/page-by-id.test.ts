/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies ID-based pagination performs lookahead only for full pages and returns no │
 * │ cursor at the end. It also checks that a failure in the lookahead query is preserved.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: ID pages only probe full pages and never expose a cursor for the final page;  │
 * │   ID pages preserve lookahead failures.                                                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Invokes #server/platform/definitions/page-by-id directly with node:test; no application  │
 * │ or database fixture is involved.                                                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';
import { Effect } from 'effect';

import { pageById } from '#server/platform/definitions/page-by-id';

testStable(
  'ID pages only probe full pages and never expose a cursor for the final page',
  async () => {
    const calls: Array<{ limit: number; before?: number }> = [];
    const query = (input: { limit: number; before?: number }) =>
      Effect.sync(() => {
        calls.push(input);

        return input.before === undefined ? [{ id: 3 }, { id: 2 }] : [{ id: 1 }];
      });

    assert.deepEqual(await Effect.runPromise(pageById(query, { limit: 2 })), {
      items: [{ id: 3 }, { id: 2 }],
      next: 2
    });
    assert.deepEqual(calls, [{ limit: 2 }, { limit: 1, before: 2 }]);
    calls.length = 0;
    assert.deepEqual(await Effect.runPromise(pageById(query, { limit: 2, before: 2 })), {
      items: [{ id: 1 }],
      next: null
    });
    assert.deepEqual(calls, [{ limit: 2, before: 2 }]);

    const terminal = ({ before }: { limit: number; before?: number }) =>
      Effect.succeed(before === undefined ? [{ id: 1 }] : []);

    assert.deepEqual(await Effect.runPromise(pageById(terminal, { limit: 1 })), {
      items: [{ id: 1 }],
      next: null
    });
    assert.deepEqual(await Effect.runPromise(pageById(() => Effect.succeed([]), { limit: 1 })), {
      items: [],
      next: null
    });
  }
);

testStable('ID pages preserve lookahead failures', async () => {
  const failure = { kind: 'transient' };
  const result = pageById(
    ({ before }: { limit: number; before?: number }) =>
      before === undefined ? Effect.succeed([{ id: 1 }]) : Effect.fail(failure),
    { limit: 1 }
  );

  assert.equal(await Effect.runPromise(Effect.flip(result)), failure);
});
