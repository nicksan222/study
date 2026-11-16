/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Admits domain records for direct official workflow executions in test fixtures.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Commits a domain generation before executing an official test workflow.                │
 * │ - Preserves real publication authorization without replacing engine behavior.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Only test fixtures use this helper; production publication checks are never replaced.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts';
import { eq, sql } from '@study/db';
import { workflow_executions } from '@study/db';
import { Effect, Option, Schema } from 'effect';
import { WorkflowEngine, Workflow } from 'effect/workflow';

import type { ServerContext } from '#server/platform/database/context';

/** Direct engine tests explicitly commit the domain admission required by publication. */
export function admitTestExecution(
  context: ServerContext,
  workflow: Pick<Workflow.AnyWithProps, '_tag' | 'payloadSchema' | 'successSchema' | 'errorSchema'>,
  id: string,
  payload: unknown
) {
  context.transaction(['workflows'], (tx) => {
    const encoded = JSON.stringify(payload, (_, value) =>
      typeof value === 'bigint' ? String(value) : value
    );

    if (
      tx.db.orm.get(
        sql`SELECT 1 FROM workflow_retired_correlations WHERE correlation_id = json_extract(${encoded}, '$.event.correlationId') AND event_type = json_extract(${encoded}, '$.event.type') LIMIT 1`
      )
    )
      throw new StudyError('cancelled', 'Workflow correlation has been retired');

    if (
      tx.db.orm
        .select()
        .from(workflow_executions)
        .where(eq(workflow_executions.execution_id, id))
        .get()
    )
      return;

    tx.db.orm
      .insert(workflow_executions)
      .values({
        execution_id: id,
        workflow_tag: workflow._tag,
        version:
          'version' in workflow && typeof workflow.version === 'number' ? workflow.version : 1,
        payload: JSON.stringify(payload, (_, value) =>
          typeof value === 'bigint' ? String(value) : value
        ),
        status: 'running',
        created_at: BigInt(context.clock.currentTimeMillisUnsafe()),
        updated_at: BigInt(context.clock.currentTimeMillisUnsafe())
      })
      .onConflictDoNothing()
      .run();
  });
}

/** Domain admission precedes direct execution without replacing official engine behavior. */
export function withTestAdmission<A, E, R>(
  context: ServerContext,
  workflow: Pick<Workflow.AnyWithProps, '_tag' | 'payloadSchema' | 'successSchema' | 'errorSchema'>,
  id: string,
  payload: unknown,
  execution: Effect.Effect<A, E, R>
) {
  return Effect.sync(() => admitTestExecution(context, workflow, id, payload)).pipe(
    Effect.andThen(execution),
    Effect.onExit(() => refreshTestExecution(context, workflow, id))
  );
}

/** Snapshot official replies for direct fixtures without running an application polling loop. */
export function refreshTestExecution(
  context: ServerContext,
  workflow: Pick<Workflow.AnyWithProps, '_tag' | 'payloadSchema' | 'successSchema' | 'errorSchema'>,
  id: string
) {
  return Effect.gen(function* () {
    const engine = yield* Effect.serviceOption(WorkflowEngine.WorkflowEngine);

    if (Option.isNone(engine)) return;

    const reply = yield* engine.value.poll(
      workflow as Workflow.Workflow<
        string,
        Workflow.AnyStructSchema,
        typeof Schema.Unknown,
        typeof Schema.Unknown
      >,
      id
    );

    if (Option.isNone(reply)) return;

    context.transaction(['workflows'], (tx) => {
      const row = tx.db.orm
        .select()
        .from(workflow_executions)
        .where(eq(workflow_executions.execution_id, id))
        .get();

      if (!row || row.cancellation_mode || row.status === 'cancelled') return;

      tx.db.orm
        .update(workflow_executions)
        .set({
          status: reply.value._tag === 'Complete' ? 'completed' : 'suspended',
          result: JSON.stringify(
            Schema.encodeSync(
              Schema.toCodecJson(
                Workflow.Result({
                  success: workflow.successSchema as Schema.Codec<unknown>,
                  error: workflow.errorSchema as Schema.Codec<unknown>
                })
              )
            )(reply.value)
          )
        })
        .where(eq(workflow_executions.execution_id, id))
        .run();
    });
  });
}
