/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists authoritative agent progress snapshots for reconnecting viewers.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks domain generation before committing agent text and tools.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Domain authorization protects snapshots independently of native execution ownership.     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  agentObservationSchema,
  procedureTraceSchema,
  agentProgressLimit,
  agentProgressSchema,
  agentToolProgressSchema
} from '@study/contracts';
import type { agentProgressInputSchema } from '@study/contracts';
import { StudyError } from '@study/contracts';
import { and, desc, eq, inArray, sql } from '@study/db';
import {
  aiUsage,
  workflow_agent_progress,
  workflow_executions,
  workflow_retired_executions
} from '@study/db';
import { Effect, Option, Schema } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import type { ServerContext, ServerTransactionContext } from '#server/platform/database/context';
import { currentWorkflowActivityOwner } from '#server/platform/workflows/ownership';
import { withPublicationGuard, PublicationGuard } from '#server/platform/workflows/publication';
import { workflowStore } from '#server/platform/workflows/store';

const traceCodec = Schema.fromJsonString(Schema.toCodecJson(procedureTraceSchema));

const toolsCodec = Schema.fromJsonString(Schema.toCodecJson(Schema.Array(agentToolProgressSchema)));

/** Replace a tool call's current state while retaining the order of distinct calls. */
function updateToolProgress(
  encoded: string,
  event: Extract<
    (typeof agentObservationSchema.Type)['event'],
    { type: 'tool-start' | 'tool-finish' }
  >,
  now: bigint
) {
  const tools = [...Schema.decodeUnknownSync(toolsCodec)(encoded)];
  const index = tools.findIndex((item) => item.toolCallId === event.toolCallId);
  const previous = tools[index];
  const tool = {
    ...previous,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    startedAtMs: previous?.startedAtMs ?? now,
    ...(event.type === 'tool-start'
      ? { input: event.input }
      : { output: event.output, errorKind: event.errorKind, finishedAtMs: now }),
    status:
      event.type === 'tool-start'
        ? ('running' as const)
        : event.outcome === 'success'
          ? ('completed' as const)
          : event.outcome === 'cancelled'
            ? ('cancelled' as const)
            : ('failed' as const)
  };

  if (index < 0) tools.push(tool);
  else tools[index] = tool;

  return Schema.encodeSync(toolsCodec)(tools);
}

/** Only terminal observations finalize bounded trace details. */
function finishTrace(
  encoded: string | null,
  event: Exclude<(typeof agentObservationSchema.Type)['event'], { type: 'start' }>,
  now: bigint
) {
  if (!encoded || (event.type !== 'complete' && event.type !== 'failed')) return encoded;

  return Schema.encodeSync(traceCodec)({
    ...Schema.decodeUnknownSync(traceCodec)(encoded),
    finishedAtMs: now,
    ...(event.type === 'complete' && event.output ? { output: event.output } : {})
  });
}

/** Advance the snapshot revision and apply one accepted text, tool or terminal update. */
function progressChanges(
  existing: { revision: bigint; tools: string; trace: string | null },
  event: Exclude<(typeof agentObservationSchema.Type)['event'], { type: 'start' }>,
  now: bigint
) {
  const update: Partial<typeof workflow_agent_progress.$inferInsert> = {
    revision: existing.revision + 1n,
    updated_at: now,
    trace: finishTrace(existing.trace, event, now)
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
      update.tools = updateToolProgress(existing.tools, event, now);
      break;
  }

  return update;
}

/**
 * Persist observations only within the current workflow activity's publication fence.
 * Starting an agent replaces only the same invocation; later writes require the same live run
 * and generation. The transaction commits before database subscribers receive refresh hints.
 */
export function observeAgentProgress(context: ServerContext) {
  return (observation: typeof agentObservationSchema.Type): Effect.Effect<void, StudyError> =>
    Effect.gen(function* () {
      const owner = yield* Effect.serviceOption(WorkflowEngine.WorkflowInstance);

      if (Option.isNone(owner)) return;

      const { executionId, attempt } = yield* currentWorkflowActivityOwner;
      const generation = yield* Effect.try({
        try: () => workflowStore(context).capturePublication(executionId),
        catch: (cause) =>
          cause instanceof StudyError
            ? cause
            : new StudyError('internal', 'Workflow progress state is unavailable', { cause })
      });
      const activityName = observation.agentId;

      yield* withPublicationGuard(
        context,
        Effect.gen(function* () {
          const guard = yield* PublicationGuard;

          yield* Effect.try({
            try: () =>
              context.transaction(['workflows'], (context) => {
                guard.assert(context);
                const value = Schema.decodeUnknownSync(agentObservationSchema)(observation);
                const event = value.event;
                const db = context.db.orm;
                const existing = db
                  .select({
                    execution_id: workflow_agent_progress.execution_id,
                    generation: workflow_agent_progress.generation,
                    status: workflow_agent_progress.status,
                    revision: workflow_agent_progress.revision,
                    tools: workflow_agent_progress.tools,
                    trace: workflow_agent_progress.trace
                  })
                  .from(workflow_agent_progress)
                  .where(eq(workflow_agent_progress.run_id, value.runId))
                  .get();
                const now = BigInt(context.timestampClock.currentTimeMillisUnsafe());

                if (event.type === 'start') {
                  db.delete(workflow_agent_progress)
                    .where(
                      and(
                        eq(workflow_agent_progress.execution_id, executionId),
                        eq(workflow_agent_progress.run_id, value.runId)
                      )
                    )
                    .run();
                  db.insert(workflow_agent_progress)
                    .values({
                      run_id: value.runId,
                      execution_id: executionId,
                      generation,
                      activity_name: activityName,
                      attempt,
                      agent_id: value.agentId,
                      phase: value.phase ?? 'generating',
                      mode: value.mode,
                      status: 'running',
                      trace: value.trace ? Schema.encodeSync(traceCodec)(value.trace) : null,
                      revision: 0n,
                      updated_at: now
                    })
                    .run();

                  return;
                }

                if (
                  !existing ||
                  existing.execution_id !== executionId ||
                  Number(existing.generation) !== generation ||
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

/** Preserve interrupted traces while the exclusive worker runtime is stopped. */
export function discardInterruptedAgentProgress(context: ServerContext): void {
  context.transaction(['workflows'], ({ db }) => {
    const now = BigInt(context.timestampClock.currentTimeMillisUnsafe());
    const interrupted = db.orm
      .select()
      .from(workflow_agent_progress)
      .where(eq(workflow_agent_progress.status, 'running'))
      .all();

    for (const row of interrupted) {
      db.orm
        .update(workflow_agent_progress)
        .set({
          ...progressChanges(row, { type: 'failed', kind: 'cancelled' }, now),
          tools: Schema.encodeSync(toolsCodec)(
            Schema.decodeUnknownSync(toolsCodec)(row.tools).map((tool) =>
              tool.status === 'running'
                ? {
                    ...tool,
                    status: 'cancelled' as const,
                    errorKind: 'cancelled' as const,
                    finishedAtMs: now
                  }
                : tool
            )
          )
        })
        .where(eq(workflow_agent_progress.run_id, row.run_id))
        .run();
    }
  });
}

/**
 * Read bounded, validated snapshots by execution or correlation for reconnecting viewers.
 * Exclude retired work, active cancellation and previews from obsolete domain generations.
 */
export function agentProgressSnapshot(
  context: Pick<ServerContext | ServerTransactionContext, 'db'>,
  input: typeof agentProgressInputSchema.Type,
  limit = agentProgressLimit
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
        sql`(${workflow_executions.status} = 'cancelled' OR (${workflow_executions.status} IN ('running', 'completed', 'suspended', 'blocked') AND ${workflow_executions.cancellation_mode} IS NULL))`,
        eq(workflow_executions.generation, workflow_agent_progress.generation)
      )
    )
    .orderBy(
      desc(workflow_executions.created_at),
      desc(workflow_executions.execution_id),
      desc(sql`${workflow_agent_progress}.rowid`)
    )
    .limit(limit)
    .all();

  const usage = new Map(
    rows.length
      ? context.db.orm
          .select({
            runId: aiUsage.runId,
            input: sql<number>`sum(${aiUsage.input})`.mapWith(Number),
            output: sql<number>`sum(${aiUsage.output})`.mapWith(Number),
            requests: sql<number>`count(*)`.mapWith(Number)
          })
          .from(aiUsage)
          .where(
            inArray(
              aiUsage.runId,
              rows.map(({ progress }) => progress.run_id)
            )
          )
          .groupBy(aiUsage.runId)
          .all()
          .map(({ runId, ...counts }) => [runId, counts] as const)
      : []
  );

  // Select the most recent bounded window, then present invocation order to reconnecting viewers.
  return rows.reverse().map(({ progress, execution }) =>
    Schema.decodeUnknownSync(agentProgressSchema)({
      executionStatus: execution.status,
      ...(progress.trace ? { trace: Schema.decodeUnknownSync(traceCodec)(progress.trace) } : {}),
      usage: usage.get(progress.run_id) ?? { input: 0, output: 0, requests: 0 },
      runId: progress.run_id,
      executionId: progress.execution_id,
      agentId: progress.agent_id,
      phase: progress.phase,
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
