/** @file Typed composition over native Activities; feature definitions retain task meaning and permissions. */
import { agentRunIdSchema, failureSchema, StudyError } from '@study/contracts';
import type { Failure, procedurePurposeSchema } from '@study/contracts';
import { Cause, Context, Effect, Schema } from 'effect';
import { Activity, WorkflowEngine } from 'effect/workflow';

import {
  agentNestingLimit,
  AgentCallSequence,
  ProcedureTraceScope,
  traceDetail
} from '#server/platform/ai/trace';
import { Database } from '#server/platform/database/database';
import { defineActivity, resumableActivity } from '#server/platform/definitions/define-activity';
import { defineTool } from '#server/platform/definitions/define-agent';
import type { ToolWiki } from '#server/platform/definitions/define-agent';
import { observeAgentProgress } from '#server/platform/workflows/agent-progress';
import { currentWorkflowActivityOwner } from '#server/platform/workflows/ownership';

interface Procedure<I extends Schema.Constraint, O extends Schema.Constraint, R> {
  readonly id: string;
  readonly purpose: typeof procedurePurposeSchema.Type;
  readonly input: I;
  readonly output: O;
  readonly execute: (input: I['Type']) => Effect.Effect<O['Type'], Failure, R>;
}

/** Procedures are reusable typed code, with sequencing and branching expressed as ordinary Effects. */
export function defineProcedure<I extends Schema.Constraint, O extends Schema.Constraint, R>(
  definition: Procedure<I, O, R>
): Procedure<I, O, R> {
  if (!/^[a-z][a-z0-9-]*$/.test(definition.id)) throw new RangeError('Invalid procedure id');

  return definition;
}

const ProcedureCalls = Context.Reference<Map<string, string> | undefined>('study/ProcedureCalls', {
  defaultValue: () => undefined
});

interface Invocation {
  /** Stable, unique call-site identity within the enclosing procedure. */
  readonly key: string;
  readonly preflight?: Effect.Effect<void, StudyError>;
  /** Compositions disable outer retries; leaf procedures own durable retries. */
  readonly retry?: boolean;
}

/** Execute a validated native checkpoint and automatically record its nested trace. */
export function runProcedure<I extends Schema.Constraint, O extends Schema.Constraint, R>(
  definition: Procedure<I, O, R>,
  input: I['Type'],
  options: Invocation
) {
  return Effect.gen(function* () {
    const parent = yield* ProcedureTraceScope;

    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(options.key) || parent.depth >= agentNestingLimit)
      return yield* Effect.fail(new StudyError('invalid_input', 'Invalid procedure invocation'));

    const path = `${parent.path}/${options.key}`;
    const calls = (yield* ProcedureCalls) ?? new Map<string, string>();
    const signature = yield* Effect.try({
      try: () =>
        new Bun.CryptoHasher('sha256')
          .update(
            JSON.stringify({ id: definition.id, input }, (_, value: unknown) =>
              typeof value === 'bigint' ? String(value) : value
            )
          )
          .digest('hex'),
      catch: (cause) => new StudyError('invalid_input', 'Invalid procedure input', { cause })
    });

    if (
      (calls.has(path) && calls.get(path) !== signature) ||
      (!calls.has(path) && calls.size >= 64)
    )
      return yield* Effect.fail(
        new StudyError('invalid_input', 'Procedure call budget or identity exhausted')
      );

    calls.set(path, signature);
    const activity = {
      name: `procedure${path}/${definition.id}`,
      success: definition.output,
      execute: Effect.gen(function* () {
        yield* options.preflight ?? Effect.void;
        const { store } = yield* Database;
        const owner = yield* currentWorkflowActivityOwner;
        const instance = yield* WorkflowEngine.WorkflowInstance;
        const runId = agentRunIdSchema.make(
          new Bun.CryptoHasher('sha256')
            .update(`${owner.executionId}/${path}/${definition.id}/${owner.attempt}`)
            .digest('hex')
        );
        const trace = {
          kind: 'procedure' as const,
          parentRunId: parent.parentRunId,
          ...(parent.parentToolCallId ? { parentToolCallId: parent.parentToolCallId } : {}),
          purpose: definition.purpose,
          attempt: owner.attempt,
          startedAtMs: BigInt(store.timestampClock.currentTimeMillisUnsafe()),
          input: traceDetail(input)
        };
        const observe = (event: Parameters<ReturnType<typeof observeAgentProgress>>[0]['event']) =>
          observeAgentProgress(store)({
            runId,
            agentId: definition.id,
            mode: 'object',
            trace,
            event
          });

        yield* observe({ type: 'start' });
        const execute = validatedProcedure(definition, input).pipe(
          Effect.provideService(AgentCallSequence, { next: 0 }),
          Effect.provideService(ProcedureCalls, calls),
          Effect.provideService(ProcedureTraceScope, {
            parentRunId: runId,
            depth: parent.depth + 1,
            path
          })
        );

        return yield* execute.pipe(
          Effect.tap((output) => observe({ type: 'complete', output: traceDetail(output) })),
          Effect.tapCause((cause) =>
            Cause.hasInterrupts(cause) && instance.suspended
              ? Effect.void
              : observe({
                  type: 'failed',
                  kind: Cause.hasInterrupts(cause) ? 'cancelled' : failureKind(Cause.squash(cause))
                }).pipe(Effect.uninterruptible)
          )
        );
      })
    };

    const accepted = yield* defineActivity({
      name: `${activity.name}/input-signature`,
      success: Schema.String,
      execute: Effect.succeed(signature)
    }).pipe(Effect.provideService(Activity.CurrentAttempt, 1));

    if (accepted !== signature)
      return yield* Effect.fail(
        new StudyError('invalid_input', 'Procedure input changed during replay')
      );

    return yield* options.retry === false ? defineActivity(activity) : resumableActivity(activity);
  });
}

function validatedProcedure<I extends Schema.Constraint, O extends Schema.Constraint, R>(
  definition: Procedure<I, O, R>,
  input: I['Type']
) {
  return Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(definition.input)(input).pipe(
      Effect.mapError(
        (cause) => new StudyError('invalid_input', 'Invalid procedure input', { cause })
      )
    );
    const output = yield* definition.execute(decoded);

    return yield* Schema.decodeUnknownEffect(definition.output)(output).pipe(
      Effect.mapError(
        (cause) => new StudyError('invalid_input', 'Invalid procedure result', { cause })
      )
    );
  });
}

function failureKind(cause: unknown) {
  return Schema.is(failureSchema)(cause) ? cause.kind : 'internal';
}

/** Expose a procedure as an explicitly permitted agent capability, including nested recording. */
export function procedureTool<
  I extends Schema.ConstraintDecoder<object> & Schema.Constraint,
  O extends Schema.ConstraintCodec<unknown, unknown, never, never>,
  R
>(
  procedure: Procedure<I, O, R>,
  capability: { description: string; wiki: ToolWiki; mutates: boolean; retry?: boolean }
) {
  return defineTool({
    ...capability,
    input: procedure.input,
    output: procedure.output,
    execute: (input) =>
      Effect.gen(function* () {
        const scope = yield* ProcedureTraceScope;
        const callKey = scope.toolKey ?? scope.parentToolCallId;

        return yield* runProcedure(procedure, input, {
          retry: capability.retry,
          key: callKey ? new Bun.CryptoHasher('sha256').update(callKey).digest('hex') : procedure.id
        }).pipe(
          Effect.mapError(
            (error) =>
              new StudyError(error.kind, error.message, {
                retryAfterMs: error.retryAfterMs,
                resource: error.resource
              })
          )
        );
      })
  });
}
