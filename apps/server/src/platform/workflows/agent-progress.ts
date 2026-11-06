/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists live agent previews and recovers generation snapshots across viewer       │
 * │ reconnects.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks activity ownership before saving generated text and tool lifecycle changes.     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the shared SQLite workflow lease; feature services expose snapshots through typed   │
 * │ RPC.                                                                                     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  agentObservationSchema,
  agentProgressSchema,
  agentToolProgressSchema
} from '@study/contracts/ai/progress';
import type { agentProgressInputSchema } from '@study/contracts/ai/progress';
import { StudyError } from '@study/contracts/errors';
import { and, desc, eq, sql } from '@study/db';
import {
  workflow_agent_progress,
  workflow_executions,
  workflow_retired_executions
} from '@study/db/schema';
import { Effect, Option, Schema } from 'effect';

import type { ServerContext } from '#server/platform/database/context';
import { WorkflowActivityOwner } from '#server/platform/workflows/ownership';
import { withPublicationGuard, PublicationGuard } from '#server/platform/workflows/publication';

const toolsCodec = Schema.fromJsonString(Schema.Array(agentToolProgressSchema));

function updateToolProgress(
  encoded: string,
  event: Extract<
    (typeof agentObservationSchema.Type)['event'],
    { type: 'tool-start' | 'tool-finish' }
  >
) {
  const tools = [...Schema.decodeUnknownSync(toolsCodec)(encoded)];
  const tool = {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    status:
      event.type === 'tool-start'
        ? ('running' as const)
        : event.outcome === 'success'
          ? ('completed' as const)
          : event.outcome === 'cancelled'
            ? ('cancelled' as const)
            : ('failed' as const)
  };
  const index = tools.findIndex((item) => item.toolCallId === tool.toolCallId);

  if (index < 0) tools.push(tool);
  else tools[index] = tool;

  return Schema.encodeSync(toolsCodec)(tools);
}

function progressChanges(
  existing: { revision: bigint; tools: string },
  event: Exclude<(typeof agentObservationSchema.Type)['event'], { type: 'start' }>,
  now: bigint
) {
  const update: Partial<typeof workflow_agent_progress.$inferInsert> = {
    revision: existing.revision + 1n,
    updated_at: now
  };

  switch (event.type) {
    case 'text-delta':
      return { ...update, text: sql`${workflow_agent_progress.text} || ${event.text}` };
    case 'complete':
      update.status = 'completed';
      break;
    case 'failed':
      update.status = event.kind === 'cancelled' ? 'cancelled' : 'failed';
      update.failure_kind = event.kind;
      break;
    case 'tool-start':
    case 'tool-finish':
      update.tools = updateToolProgress(existing.tools, event);
      break;
  }

  return update;
}

export function observeAgentProgress(context: ServerContext) {
  return (observation: typeof agentObservationSchema.Type): Effect.Effect<void, StudyError> =>
    Effect.gen(function* () {
      const owner = yield* Effect.serviceOption(WorkflowActivityOwner);

      if (Option.isNone(owner)) return;

      const { executionId, ownerToken, activityName, attempt } = owner.value;

      yield* withPublicationGuard(
        context,
        Effect.gen(function* () {
          const guard = yield* PublicationGuard;

          yield* Effect.try({
            try: () =>
              context.transaction(() => {
                guard.assert(context);
                const value = Schema.decodeUnknownSync(agentObservationSchema)(observation);
                const event = value.event;
                const db = context.db.orm;
                const existing = db
                  .select({
                    execution_id: workflow_agent_progress.execution_id,
                    owner_token: workflow_agent_progress.owner_token,
                    status: workflow_agent_progress.status,
                    revision: workflow_agent_progress.revision,
                    tools: workflow_agent_progress.tools
                  })
                  .from(workflow_agent_progress)
                  .where(eq(workflow_agent_progress.run_id, value.runId))
                  .get();
                const now = BigInt(context.clock.currentTimeMillisUnsafe());

                if (event.type === 'start') {
                  db.delete(workflow_agent_progress)
                    .where(
                      and(
                        eq(workflow_agent_progress.execution_id, executionId),
                        eq(workflow_agent_progress.activity_name, activityName),
                        eq(workflow_agent_progress.agent_id, value.agentId)
                      )
                    )
                    .run();
                  db.insert(workflow_agent_progress)
                    .values({
                      run_id: value.runId,
                      execution_id: executionId,
                      owner_token: ownerToken,
                      activity_name: activityName,
                      attempt,
                      agent_id: value.agentId,
                      mode: value.mode,
                      status: 'running',
                      revision: 0n,
                      updated_at: now
                    })
                    .run();

                  return;
                }

                if (
                  !existing ||
                  existing.execution_id !== executionId ||
                  existing.owner_token !== ownerToken ||
                  existing.status !== 'running'
                )
                  throw new StudyError('cancelled', 'Agent progress is no longer active');

                db.update(workflow_agent_progress)
                  .set(progressChanges(existing, event, now))
                  .where(eq(workflow_agent_progress.run_id, value.runId))
                  .run();
              }),
            catch: (cause) =>
              cause instanceof StudyError
                ? cause
                : new StudyError('internal', 'Could not save agent progress', { cause })
          });
        })
      );
    });
}

export function agentProgressSnapshot(
  context: Pick<ServerContext, 'db'>,
  input: typeof agentProgressInputSchema.Type,
  limit = 100
): (typeof agentProgressSchema.Type)[] {
  const rows = context.db.orm
    .select({ progress: workflow_agent_progress, execution: workflow_executions })
    .from(workflow_agent_progress)
    .innerJoin(
      workflow_executions,
      eq(workflow_agent_progress.execution_id, workflow_executions.execution_id)
    )
    .leftJoin(
      workflow_retired_executions,
      eq(workflow_retired_executions.execution_id, workflow_executions.execution_id)
    )
    .where(
      and(
        'executionId' in input
          ? eq(workflow_executions.execution_id, input.executionId)
          : eq(
              sql<string>`json_extract(${workflow_executions.payload}, '$.event.correlationId')`,
              input.correlationId
            ),
        sql`${workflow_retired_executions.execution_id} IS NULL`,
        sql`${workflow_executions.status} IN ('running', 'completed')`,
        sql`(${workflow_executions.result} IS NULL OR ${workflow_executions.result} NOT IN ('"__interrupt_safe__"', '"__interrupt_unsafe__"'))`,
        sql`(${workflow_executions.status} != 'running' OR ${workflow_executions.owner_token} = ${workflow_agent_progress.owner_token})`
      )
    )
    .orderBy(
      desc(workflow_executions.created_at),
      desc(workflow_executions.execution_id),
      workflow_agent_progress.activity_name,
      workflow_agent_progress.agent_id
    )
    .limit(limit)
    .all();

  return rows.map(({ progress, execution }) =>
    Schema.decodeUnknownSync(agentProgressSchema)({
      executionStatus: execution.status,
      runId: progress.run_id,
      executionId: progress.execution_id,
      agentId: progress.agent_id,
      mode: progress.mode,
      status: progress.status,
      failureKind: progress.failure_kind,
      text: progress.text,
      tools: Schema.decodeUnknownSync(toolsCodec)(progress.tools),
      revision: progress.revision,
      updatedAtMs: progress.updated_at
    })
  );
}
