import type { runSelectionContextSchema } from '@study/contracts/conversations/context';
import type { transformSuggestionInputSchema } from '@study/contracts/conversations/rpc';
import { StudyError } from '@study/contracts/errors';
import { Effect, Option } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { WorkflowControl } from '#server/platform/workflows/control';
import { triggeredExecutionId } from '#server/platform/workflows/triggers';

import { transformSuggestionWorkflow } from '../workflows/transform-suggestion-definition.ts';
import { Conversations } from './index.ts';

/** Compare saved evidence, excluding the identity of the capture itself. */
function evidence(context: typeof runSelectionContextSchema.Type) {
  return JSON.stringify(
    {
      selectionRevision: context.selectionRevision,
      includedSessions: context.includedSessions,
      messages: context.messages,
      inputs: context.inputs
    },
    (_, value: unknown) => (typeof value === 'bigint' ? String(value) : value)
  );
}

/** Suggestions never rename a session or submit a Document transformation. */
export const suggestTransformField = (input: typeof transformSuggestionInputSchema.Type) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    const capture = {
      sessionId: input.sessionId,
      additionalSessionIds: input.additionalSessionIds?.length
        ? input.additionalSessionIds
        : undefined,
      instruction: '',
      preferences: { language: input.language }
    };
    const event = yield* conversations.requestTransformSuggestion(input);
    const context = yield* conversations.sessionContext({ requestId: event.contextRequestId });
    const execution = Effect.flatMap(WorkflowEngine.WorkflowEngine, (engine) =>
      engine.execute(transformSuggestionWorkflow, {
        executionId: triggeredExecutionId(event, {
          subscription: 'transform-suggestion',
          workflowVersion: transformSuggestionWorkflow.version
        }),
        payload: { event }
      })
    ).pipe(
      Effect.mapError(
        (error) =>
          new StudyError(error.kind, error.message, {
            retryAfterMs: error.retryAfterMs ?? undefined
          })
      )
    );
    const engine = yield* Effect.serviceOption(WorkflowEngine.WorkflowEngine);
    const control = yield* Effect.serviceOption(WorkflowControl);
    const result = yield* Option.isSome(engine)
      ? execution.pipe(Effect.provideService(WorkflowEngine.WorkflowEngine, engine.value))
      : Option.isSome(control) && control.value.run
        ? control.value.run(execution)
        : Effect.fail(new StudyError('unsupported', 'Workflow execution is unavailable'));
    const current = yield* conversations.captureSessionContext({
      ...capture,
      intentKey: crypto.randomUUID()
    });

    if (evidence(context) !== evidence(current))
      return yield* Effect.fail(new StudyError('invalid_input', 'Suggestion context changed'));

    return result;
  });
