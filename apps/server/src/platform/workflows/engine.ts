/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Composes official embedded Effect infrastructure in the shared application         │
 * │ database.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies official persistence and scoped lifecycle boundaries.                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Domain initialization and exclusive process ownership precede building this scoped       │
 * │ layer.                                                                                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunCrypto } from '@effect/platform-bun';
import { SqliteClient } from '@effect/sql-sqlite-bun';
import { StudyError } from '@study/contracts/errors';
import type { Context } from 'effect';
import { Cause, Effect, Layer } from 'effect';
import type { MessageStorage, Runners, Sharding } from 'effect/cluster';
import { ClusterWorkflowEngine, SingleRunner, SqlMessageStorage } from 'effect/cluster';
import type { WorkflowEngine } from 'effect/workflow';

import type { ServerContext } from '#server/platform/database/context';

/** Domain migrations and exclusive database ownership precede building this scoped layer. */
export function workflowEngineLayer(context: ServerContext) {
  return ClusterWorkflowEngine.layer.pipe(
    Layer.provideMerge(
      SingleRunner.layer({
        runnerStorage: 'memory',
        shardingConfig: {
          entityMessagePollInterval: '250 millis',
          entityReplyPollInterval: '250 millis',
          entityTerminationTimeout: '1 second',
          entityMailboxCapacity: 128,
          maxResidentEntities: 128,
          unprocessedMessageBatchSize: 100
        }
      })
    ),
    Layer.provide(SqliteClient.layer({ filename: context.db.path })),
    Layer.provide(BunCrypto.layer),
    Layer.catchCause((cause) =>
      Layer.effectContext(
        Effect.fail(
          new StudyError('internal', 'Workflow infrastructure initialization failed', {
            cause: Cause.squash(cause)
          })
        ) as Effect.Effect<
          Context.Context<
            | WorkflowEngine.WorkflowEngine
            | MessageStorage.MessageStorage
            | Runners.Runners
            | Sharding.Sharding
          >,
          StudyError
        >
      )
    )
  );
}

/** Runs only official SQL infrastructure migrations, without starting a runner. */
export function initializeWorkflowInfrastructure(filename: string) {
  return Layer.build(SqlMessageStorage.layerMigrations({})).pipe(
    Effect.provide(SqliteClient.layer({ filename })),
    Effect.scoped,
    Effect.asVoid,
    Effect.catchCause((cause) =>
      Effect.fail(
        new StudyError('internal', 'Workflow infrastructure initialization failed', {
          cause: Cause.squash(cause)
        })
      )
    )
  );
}
