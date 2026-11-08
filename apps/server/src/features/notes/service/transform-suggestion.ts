/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates saved note evidence and durable transformation field suggestions.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Captures suggestion requests and waits for their checkpointed results.                 │
 * │ - Rejects results when saved note evidence changes during generation.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Note services own evidence capture; the workflow engine owns durable execution.          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { runSelectionContextSchema } from '@study/contracts/notes/context';
import type { transformSuggestionInputSchema } from '@study/contracts/notes/rpc';
import { Effect, Option } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { WorkflowControl } from '#server/platform/workflows/control';
import { triggeredExecutionId } from '#server/platform/workflows/triggers';

import { Notes } from './index.ts';
import { transformSuggestionWorkflow } from './transform-suggestion-definition.ts';

/** Compare saved evidence, excluding the identity of the capture itself. */
function evidence(context: typeof runSelectionContextSchema.Type) {
  return JSON.stringify(
    {
      selectionRevision: context.selectionRevision,
      includedNotes: context.includedNotes,
      messages: context.messages,
      inputs: context.inputs
    },
    (_, value: unknown) => (typeof value === 'bigint' ? String(value) : value)
  );
}

/** Suggestions never rename a note or submit a Document transformation. */
export const suggestTransformField = (input: typeof transformSuggestionInputSchema.Type) =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const capture = {
      noteId: input.noteId,
      additionalNoteIds: input.additionalNoteIds?.length ? input.additionalNoteIds : undefined,
      instruction: '',
      preferences: { language: input.language }
    };
    const event = yield* notes.requestTransformSuggestion(input);
    const context = yield* notes.noteContext({ requestId: event.contextRequestId });
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
    const current = yield* notes.captureNoteContext({
      ...capture,
      intentKey: crypto.randomUUID()
    });

    if (evidence(context) !== evidence(current))
      return yield* Effect.fail(new StudyError('invalid_input', 'Suggestion context changed'));

    return result;
  });
