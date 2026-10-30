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
import { Database } from '#server/platform/database/database';
import { defineService } from '#server/platform/definitions/define-service';
import { transaction } from '#server/platform/definitions/define-store';
import { emitEvent } from '#server/platform/workflows/events';
import { PublicationGuard } from '#server/platform/workflows/publication';

export const Learning = defineService(
  'study/Learning',
  Effect.gen(function* () {
    const { store: context } = yield* Database;
    const settings = yield* Settings;
    const materials = yield* Materials;
    const attempts = AttemptStore.make(context),
      cards = CardStore.make(context),
      reviews = ReviewStore.make(context);

    const requestSlot = (
      slotId: string,
      projectId: typeof practiceInputSchema.Type.projectId,
      epoch: string,
      generationAttempt = 0
    ) => {
      emitEvent(
        context,
        {
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
        },
        context.clock.currentTimeMillisUnsafe()
      );
    };

    return {
      practice: PracticeStore.make(context).practice,
      practiceSlot: (slotId: string) =>
        PracticeSlotStore.make(context)
          .findPracticeSlot({ slotId })
          .pipe(Effect.map(Option.getOrNull)),
      startPractice: (input: typeof startPracticeInputSchema.Type) =>
        transaction(context, (tx) => {
          const ids = tx.store(PracticeStore).start(input);
          const result = tx.store(PracticeStore).practice({ projectId: input.projectId });

          for (const id of ids) requestSlot(id, input.projectId, result.epoch!);

          return result;
        }),
      stopPractice: (input: typeof practiceInputSchema.Type) =>
        Effect.gen(function* () {
          const current = yield* PracticeControlStore.make(context).findPracticeControl(input);

          if (Option.isSome(current) && current.value.enabled) {
            yield* materials.closeGenerationScope({
              scopeId: current.value.epoch,
              projectId: input.projectId
            });
            yield* transaction(context, (tx) =>
              tx.store(PracticeStore).stop({ ...input, epoch: current.value.epoch })
            );
          }

          return yield* PracticeStore.make(context).practice(input);
        }),
      publishPracticeSlot: (input: typeof publishPracticeSlotInputSchema.Type) =>
        Effect.gen(function* () {
          const guard = yield* PublicationGuard;

          return yield* transaction(context, (tx) => {
            guard.assert();

            return tx.store(PracticeStore).publish(input);
          });
        }),
      retryPracticeQuestion: (input: typeof retryPracticeQuestionInputSchema.Type) =>
        transaction(context, (tx) => {
          const result = tx.store(PracticeStore).retry(input);

          if (result.requested)
            requestSlot(
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
        Effect.gen(function* () {
          const guard = yield* PublicationGuard;

          return yield* transaction(context, (tx) => {
            guard.assert();

            return tx.store(PracticeStore).fail(input);
          });
        }),
      answerPracticeQuestion: (input: typeof answerPracticeQuestionInputSchema.Type) =>
        transaction(context, (tx) => {
          const result = tx.store(PracticeStore).answer(input);

          if (result.slotId && input.answer.type === 'open') {
            const eventId = randomUUID();

            emitEvent(
              context,
              {
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
              },
              context.clock.currentTimeMillisUnsafe()
            );
          }

          if (result.slotId) requestSlot(result.slotId, result.projectId, result.epoch);

          return result.attempt;
        }),
      gradingSnapshot: GradingSnapshotStore.make(context).gradingSnapshot,
      attempt: attempts.attempt,
      findAttempt: attempts.findAttempt,
      card: cards.card,
      findCard: cards.findCard,
      answerQuestion: (input: typeof answerQuestionInputSchema.Type) =>
        transaction(context, (tx) => {
          const result = tx.store(AttemptStore).answerQuestion(input);

          if (input.answer.type === 'open') {
            const eventId = randomUUID();

            emitEvent(
              context,
              {
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
              },
              context.clock.currentTimeMillisUnsafe()
            );
          }

          return result;
        }),
      finishQuiz: (input: typeof attemptInputSchema.Type) =>
        transaction(context, (tx) => tx.store(AttemptStore).finishQuiz(input)),
      gradeResponse: (input: typeof gradeResponseInputSchema.Type) =>
        transaction(context, (tx) => tx.store(AttemptStore).gradeResponse(input)),
      publishGrade: (input: typeof publishGradeInputSchema.Type) =>
        Effect.gen(function* () {
          const guard = yield* PublicationGuard;

          return yield* transaction(context, (tx) => {
            guard.assert();

            return tx.store(AttemptStore).publishGrade(input);
          });
        }),
      startQuiz: (input: typeof startQuizInputSchema.Type) =>
        transaction(context, (tx) => tx.store(AttemptStore).startQuiz(input)),
      reviewCard: (input: typeof reviewCardInputSchema.Type) =>
        transaction(context, (tx) => tx.store(CardStore).reviewCard(input)),
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
