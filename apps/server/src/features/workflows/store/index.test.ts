import { workflow_executions } from '@study/db';
import { ServerContext, Database, useStore } from '@study/server';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies bounded workflow reads filter before applying pagination limits.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Finds source outcomes behind unrelated newer workflow executions.                      │
 * │ - Preserves correlation identity when selecting filtered executions.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Exercises the private store through public database and typed store services.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect } from 'effect';

import { ExecutionStore } from './index.ts';

test.server.stable(
  'workflow filters find a source outcome behind unrelated newer wake executions in one bounded read',
  async ({ databases, expect }) => {
    const fixture = await databases();
    const context = new ServerContext(await fixture.open());

    try {
      context.transaction(['workflows'], (tx) => {
        for (let index = 0; index < 202; index++) {
          tx.db.orm
            .insert(workflow_executions)
            .values({
              execution_id: String(index),
              workflow_tag: index < 2 ? 'source-correction/v1' : 'conversation-attachment-wake/v1',
              version: 1,
              payload: JSON.stringify({
                event: { correlationId: index === 1 ? 'other-request' : 'source-request' }
              }),
              status: 'cancelled',
              created_at: BigInt(index),
              updated_at: BigInt(index)
            })
            .run();
        }
      });
      const items = await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* useStore(ExecutionStore);

          return yield* store.executions({
            correlationId: 'source-request',
            workflows: ['source-ingestion/v1', 'source-correction/v1'],
            limit: 1
          });
        }).pipe(Effect.provideService(Database, { store: context }))
      );

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: '0',
        workflow: 'source-correction/v1',
        correlationId: 'source-request',
        outcome: 'failure',
        failureKind: 'cancelled'
      });
    } finally {
      context.close();
      await fixture.cleanup();
    }
  }
);
