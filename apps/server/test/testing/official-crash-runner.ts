/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises official SQLite acceptance, recovery, durable waits and explicit         │
 * │ interruption.                                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies official persistence and scoped lifecycle boundaries.                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses real SQLite files and official runtime layers without a substitute execution        │
 * │ engine.                                                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunCrypto } from '@effect/platform-bun';
import { SqliteClient } from '@effect/sql-sqlite-bun';
import { Effect, Layer, ManagedRuntime, Option, Schedule, Schema } from 'effect';
import { ClusterWorkflowEngine, SingleRunner } from 'effect/cluster';
import { SqlClient } from 'effect/sql';
import { Activity, DurableClock, Workflow } from 'effect/workflow';

export const crashWorkflow = Workflow.make('StudyCrashAcceptanceProofV1', {
  payload: { id: Schema.String },
  success: Schema.Number,
  idempotencyKey: ({ id }) => id
});

export function crashLayer(filename: string) {
  const sql = SqliteClient.layer({ filename });
  const engine = ClusterWorkflowEngine.layer.pipe(
    Layer.provide(
      SingleRunner.layer({
        runnerStorage: 'memory',
        shardingConfig: { shardsPerGroup: 1, entityMessagePollInterval: '20 millis' }
      })
    ),
    Layer.provide(sql),
    Layer.provide(BunCrypto.layer)
  );

  return crashWorkflow
    .toLayer(() =>
      Effect.gen(function* () {
        const result = yield* Activity.make({
          name: 'paid-effect',
          success: Schema.Number,
          execute: Effect.gen(function* () {
            const client = yield* SqlClient.SqlClient;

            yield* client`INSERT INTO proof_calls DEFAULT VALUES`.pipe(Effect.orDie);

            return 1;
          })
        });

        yield* DurableClock.sleep({
          name: 'restart-wait',
          duration: '2 seconds',
          inMemoryThreshold: 0
        });

        return result;
      })
    )
    .pipe(Layer.provideMerge(engine), Layer.provide(sql));
}

if (import.meta.main) {
  const runtime = ManagedRuntime.make(crashLayer(Bun.argv[2]!));

  await runtime.runPromise(
    Effect.gen(function* () {
      const id = yield* crashWorkflow.execute({ id: 'accepted-before-ack' }, { discard: true });

      yield* crashWorkflow.poll(id).pipe(
        Effect.repeat({
          while: (result) => Option.isNone(result) || result.value._tag !== 'Suspended',
          schedule: Schedule.spaced('5 millis')
        })
      );
      console.log('accepted-before-domain-ack');
      yield* Effect.never;
    })
  );
}
