/** @file Owns the request-scoped exam transcript and starts each native workflow turn. */
import { StudyError, failureSchema } from '@study/contracts';
import type { WrittenExamInput, WrittenExamResult } from '@study/contracts';
import { WorkflowControl, defineWorkflow } from '@study/server';
import { Deferred, Effect, Option, Schema } from 'effect';

export const writtenExamWorkflow = defineWorkflow({
  name: 'written-exam',
  version: 1,
  payload: Schema.Struct({ requestId: Schema.String }),
  success: Schema.Void,
  error: failureSchema,
  idempotencyKey: ({ requestId }) => requestId
});

export function writtenExamOperations() {
  // Preserve workflow scheduling and checkpoints without storing the learner's transcript.
  const pending = new Map<
    string,
    {
      input: WrittenExamInput;
      reply: Deferred.Deferred<WrittenExamResult>;
      closed: Deferred.Deferred<void>;
    }
  >();

  return {
    pendingExamTurn: (requestId: string) =>
      Effect.suspend(() => {
        const turn = pending.get(requestId);

        return turn
          ? Effect.succeed(turn)
          : Effect.fail(new StudyError('cancelled', 'Written exam request ended'));
      }),
    writtenExam: Effect.fnUntraced(function* (input: WrittenExamInput) {
      if (input.step.kind === 'hint' && input.step.current.hint !== undefined)
        return yield* Effect.fail(
          new StudyError('invalid_input', 'Written exam already gave a hint')
        );

      const control = yield* Effect.serviceOption(WorkflowControl);

      if (Option.isNone(control) || !control.value.run)
        return yield* Effect.fail(new StudyError('unsupported', 'Exam runtime unavailable'));

      const reply = yield* Deferred.make<WrittenExamResult>();
      const closed = yield* Deferred.make<void>();
      const requestId = crypto.randomUUID();
      const run = control.value.run(
        writtenExamWorkflow
          .execute({ requestId })
          .pipe(
            Effect.mapError(
              ({ kind, message, retryAfterMs, resource }) =>
                new StudyError(kind, message, { retryAfterMs, ...(resource ? { resource } : {}) })
            )
          )
      );

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          pending.set(requestId, { input, reply, closed });
        }),
        () => run.pipe(Effect.andThen(Deferred.await(reply))),
        () =>
          Deferred.succeed(closed, undefined).pipe(
            Effect.andThen(
              Effect.sync(() => {
                pending.delete(requestId);
              })
            )
          )
      );
    })
  };
}
