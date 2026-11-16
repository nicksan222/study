/** @file Owns practice within this feature. */

import type {
  ErrorKind,
  answerPracticeQuestionInputSchema,
  practiceInputSchema,
  publishPracticeSlotInputSchema,
  retryPracticeQuestionInputSchema,
  startPracticeInputSchema
} from '@study/contracts';
import { CryptoHasher } from 'bun';
import { Effect, Option } from 'effect';

import { PracticeStore } from '#server/features/learning/store/practice';
import { PracticeControlStore } from '#server/features/learning/store/practice-controls';
import { PracticeSlotStore } from '#server/features/learning/store/practice-slots';
import { Materials } from '#server/features/materials/index';
import type { Transaction } from '#server/platform/definitions/define-store';
import {
  publicationTransaction,
  transaction,
  useStore
} from '#server/platform/definitions/define-store';

export function* learningPracticeOperations() {
  const readPracticeStore = yield* useStore(PracticeStore);

  const readPracticeSlotStore = yield* useStore(PracticeSlotStore);

  const readPracticeControlStore = yield* useStore(PracticeControlStore);

  const materials = yield* Materials;

  const requestSlot = (
    tx: Transaction,
    slotId: string,
    projectId: typeof practiceInputSchema.Type.projectId,
    epoch: string,
    generationAttempt = 0
  ) => {
    tx.emit({
      type: 'PracticeSlotRequested',
      eventId: crypto.randomUUID(),
      causationId: null,
      correlationId: slotId,
      inputVersion: 1,
      depth: 0,
      slotId,
      projectId,
      epoch,
      generationAttempt
    });
  };

  return {
    practice: readPracticeStore.practice,
    practiceSlot: (slotId: string) =>
      readPracticeSlotStore.findPracticeSlot({ slotId }).pipe(Effect.map(Option.getOrNull)),
    startPractice: (input: typeof startPracticeInputSchema.Type) =>
      transaction((tx) => {
        Materials.validateContentInputsInTransaction(tx, input.inputs, input.projectId, true);
        const ids = tx.store(PracticeStore).start(input);

        const result = tx.store(PracticeStore).practice({ projectId: input.projectId });

        for (const id of ids) requestSlot(tx, id, input.projectId, result.epoch!);

        return result;
      }),
    stopPractice: Effect.fnUntraced(function* (input: typeof practiceInputSchema.Type) {
      const current = yield* readPracticeControlStore.findPracticeControl(input);

      if (Option.isSome(current) && current.value.enabled) {
        yield* materials.closeGenerationScope({
          scopeId: current.value.epoch,
          projectId: input.projectId
        });
        yield* transaction((tx) =>
          tx.store(PracticeStore).stop({ ...input, epoch: current.value.epoch })
        );
      }

      return yield* readPracticeStore.practice(input);
    }),
    publishPracticeSlot: (input: typeof publishPracticeSlotInputSchema.Type) =>
      publicationTransaction((tx) => {
        return tx.store(PracticeStore).publish(input);
      }),
    retryPracticeQuestion: (input: typeof retryPracticeQuestionInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(PracticeStore).retry(input);

        if (result.requested)
          requestSlot(
            tx,
            result.slot.slotId,
            result.slot.projectId,
            result.slot.epoch,
            Number(result.slot.generationAttempt)
          );

        return result.slot;
      }),
    failPracticeSlot: (input: {
      slotId: string;
      projectId: typeof practiceInputSchema.Type.projectId;
      generationEventId: string;
      errorKind: ErrorKind;
    }) =>
      publicationTransaction((tx) => {
        return tx.store(PracticeStore).fail(input);
      }),
    answerPracticeQuestion: (input: typeof answerPracticeQuestionInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(PracticeStore).answer(input);

        if (result.slotId && input.answer.type === 'open') {
          const eventId = crypto.randomUUID();

          tx.emit({
            type: 'QuizAnswerSubmitted',
            eventId,
            correlationId: eventId,
            causationId: null,
            inputVersion: 1,
            depth: 0,
            attemptId: result.attempt.id,
            questionId: result.questionId,
            answerHash: new CryptoHasher('sha256')
              .update(JSON.stringify([input.answer.answer, eventId]))
              .digest('hex')
          });
        }

        if (result.slotId) requestSlot(tx, result.slotId, result.projectId, result.epoch);

        return result.attempt;
      })
  };
}
