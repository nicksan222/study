import { createHash, randomUUID } from 'node:crypto';

import type { ErrorKind } from '@study/contracts/errors';
import type {
  answerQuestionInputSchema,
  attemptInputSchema,
  attemptsInputSchema,
  dueCardsInputSchema,
  gradeResponseInputSchema,
  publishGradeInputSchema,
  reviewCardInputSchema,
  reviewHistoryInputSchema,
  startQuizInputSchema
} from '@study/contracts/learning/rpc';
import type {
  startPracticeInputSchema,
  practiceInputSchema,
  answerPracticeQuestionInputSchema,
  retryPracticeQuestionInputSchema,
  publishPracticeSlotInputSchema
} from '@study/contracts/learning/rpc';
import { Effect, Option } from 'effect';

import {
  AttemptStore,
  CardStore,
  ReviewStore,
  GradingSnapshotStore
} from '#server/features/learning/store/index';
import {
  PracticeStore,
  PracticeSlotStore,
  PracticeControlStore
} from '#server/features/learning/store/practice';
import { Materials } from '#server/features/materials/index';
import { Settings } from '#server/features/settings/index';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';
import {
  transaction,
  useStore,
  publicationTransaction
} from '#server/platform/definitions/define-store';

export const Learning = defineService(
  'study/Learning',
  Effect.gen(function* () {
    const readPracticeStore = yield* useStore(PracticeStore);
    const readPracticeSlotStore = yield* useStore(PracticeSlotStore);
    const readPracticeControlStore = yield* useStore(PracticeControlStore);
    const readGradingSnapshotStore = yield* useStore(GradingSnapshotStore);
    const settings = yield* Settings;
    const materials = yield* Materials;
    const attempts = yield* useStore(AttemptStore),
      cards = yield* useStore(CardStore),
      reviews = yield* useStore(ReviewStore);

    const requestSlot = (
      tx: Transaction,
      slotId: string,
      projectId: typeof practiceInputSchema.Type.projectId,
      epoch: string,
      generationAttempt = 0
    ) => {
      tx.emit({
        type: 'PracticeSlotRequested',
        eventId: randomUUID(),
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
          const ids = tx.store(PracticeStore).start(input);
          const result = tx.store(PracticeStore).practice({ projectId: input.projectId });

          for (const id of ids) requestSlot(tx, id, input.projectId, result.epoch!);

          return result;
        }),
      stopPractice: (input: typeof practiceInputSchema.Type) =>
        Effect.gen(function* () {
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
            const eventId = randomUUID();

            tx.emit({
              type: 'QuizAnswerSubmitted',
              eventId,
              correlationId: eventId,
              causationId: null,
              inputVersion: 1,
              depth: 0,
              attemptId: result.attempt.id,
              questionId: result.questionId,
              answerHash: createHash('sha256')
                .update(JSON.stringify([input.answer.answer, eventId]))
                .digest('hex')
            });
          }

          if (result.slotId) requestSlot(tx, result.slotId, result.projectId, result.epoch);

          return result.attempt;
        }),
      gradingSnapshot: readGradingSnapshotStore.gradingSnapshot,
      attempt: attempts.attempt,
      findAttempt: attempts.findAttempt,
      card: cards.card,
      findCard: cards.findCard,
      answerQuestion: (input: typeof answerQuestionInputSchema.Type) =>
        transaction((tx) => {
          const result = tx.store(AttemptStore).answerQuestion(input);

          if (input.answer.type === 'open') {
            const eventId = randomUUID();

            tx.emit({
              type: 'QuizAnswerSubmitted',
              eventId,
              correlationId: eventId,
              causationId: null,
              inputVersion: 1,
              depth: 0,
              attemptId: input.attemptId,
              questionId: input.questionId,
              answerHash: createHash('sha256')
                .update(JSON.stringify([input.answer.answer, eventId]))
                .digest('hex')
            });
          }

          return result;
        }),
      finishQuiz: (input: typeof attemptInputSchema.Type) =>
        transaction((tx) => tx.store(AttemptStore).finishQuiz(input)),
      gradeResponse: (input: typeof gradeResponseInputSchema.Type) =>
        transaction((tx) => tx.store(AttemptStore).gradeResponse(input)),
      publishGrade: (input: typeof publishGradeInputSchema.Type) =>
        publicationTransaction((tx) => {
          return tx.store(AttemptStore).publishGrade(input);
        }),
      startQuiz: (input: typeof startQuizInputSchema.Type) =>
        transaction((tx) => tx.store(AttemptStore).startQuiz(input)),
      reviewCard: (input: typeof reviewCardInputSchema.Type) =>
        transaction((tx) => tx.store(CardStore).reviewCard(input)),
      dueCards: (input: typeof dueCardsInputSchema.Type) =>
        Effect.gen(function* () {
          const policy = yield* settings.reviewSettings();
          const items = yield* cards.cards({ ...input, ...policy });
          const last = items.at(-1);
          const cursor = last ? { due: last.due, cardId: last.snapshot.card_id } : undefined;
          const more =
            cursor && items.length === input.limit
              ? yield* cards.cards({ ...input, ...policy, cursor, limit: 1 })
              : [];

          return { items, nextCursor: more.length && cursor ? cursor : null };
        }),
      attempts: (input: typeof attemptsInputSchema.Type) =>
        Effect.gen(function* () {
          const items = yield* attempts.attempts(input);
          const last = items.at(-1);
          const more =
            last && items.length === input.limit
              ? yield* attempts.attempts({ ...input, cursor: last.attempt.id, limit: 1 })
              : [];

          return { items, nextCursor: more.length && last ? last.attempt.id : null };
        }),
      reviewHistory: (input: typeof reviewHistoryInputSchema.Type) =>
        Effect.gen(function* () {
          const items = yield* reviews.reviews(input);
          const last = items.at(-1);
          const more =
            last && items.length === input.limit
              ? yield* reviews.reviews({ ...input, cursor: last.review.id, limit: 1 })
              : [];

          return { items, nextCursor: more.length && last ? last.review.id : null };
        })
    };
  })
);
