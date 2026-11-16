/** @file Owns practice within this feature. */

import {
  answerPracticeQuestionInputSchema,
  errorKindSchema,
  practiceInputSchema,
  practiceSchema,
  practiceSlotSchema,
  projectIdSchema,
  publishPracticeSlotInputSchema,
  quizAttemptSchema,
  quizQuestionIdSchema,
  retryPracticeQuestionInputSchema,
  startPracticeInputSchema
} from '@study/contracts';
import * as s from '@study/db';
import { eq } from '@study/db';
import { requireRow, defineStore, storeMutation, storeQuery, invalid } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { makePracticeFailures } from './practice-failures.ts';
import { makePracticePublication } from './practice-publication.ts';
import { makePracticeQueries } from './practice-queries.ts';
import { makePracticeReservations } from './practice-reservations.ts';
import { generationEventId, slots } from './practice-schemas.ts';

export function makePractice(resources: StoreResources) {
  const { failureKind } = makePracticeFailures(resources);
  const { control, view, activeSlot, practice, answerSlot } = makePracticeQueries(resources);
  const { start, stop, refill } = makePracticeReservations(resources);
  const { publish, assertRetrySlot, attemptView, answerQuestion } =
    makePracticePublication(resources);

  return {
    practice,
    start,
    stop,
    publish,
    answerSlot,
    assertRetrySlot,
    refill,
    control,
    failureKind,
    activeSlot,
    attemptView,
    answerQuestion,
    view
  };
}

export const PracticeStore = defineStore({
  name: 'study/LearningPracticeStore',
  entity: { singular: 'practice', plural: 'practices' },
  make: (resources) => {
    const { db } = resources;

    const {
      practice,
      start,
      stop,
      publish,
      answerSlot,
      assertRetrySlot,
      refill,
      control,
      failureKind,
      attemptView,
      answerQuestion,
      view
    } = makePractice(resources);

    return {
      queries: {
        practice: storeQuery({
          role: 'required',
          input: practiceInputSchema,
          output: practiceSchema,
          run: (input) => practice(input.projectId)
        })
      },
      mutations: {
        start: storeMutation({
          changes: ['learning'],
          input: startPracticeInputSchema,
          output: Schema.Array(Schema.String),
          run: (input) => start(input.projectId, input.inputs)
        }),
        stop: storeMutation({
          changes: ['learning'],
          input: Schema.Struct({ ...practiceInputSchema.fields, epoch: Schema.String }),
          output: Schema.Void,
          run: (input) => stop(input.projectId, input.epoch)
        }),
        publish: storeMutation({
          changes: ['learning'],
          input: publishPracticeSlotInputSchema,
          output: Schema.NullOr(quizAttemptSchema),
          run: (input) => publish(input.slotId, input.versionId)
        }),
        answer: storeMutation({
          changes: ['learning'],
          input: answerPracticeQuestionInputSchema,
          output: Schema.Struct({
            attempt: quizAttemptSchema,
            slotId: Schema.NullOr(Schema.String),
            projectId: projectIdSchema,
            epoch: Schema.String,
            questionId: quizQuestionIdSchema
          }),
          run: (input) => {
            const row = answerSlot(input.slotId);

            const attempt = attemptView(row.attempt_id!);

            if (!attempt.questions[0]) invalid('invalid practice attempt');

            const questionId = attempt.questions[0].id;

            if (row.status === 'answered') {
              const same = sameAnswer(attempt.questions[0].answer, input.answer);

              if (!same) invalid('practice answer differs from the committed response');

              return {
                attempt,
                slotId: null,
                projectId: row.project_id,
                epoch: row.epoch,
                questionId
              };
            }

            if (attempt.status !== 'in_progress') invalid('invalid practice attempt');

            const result = answerQuestion(
              {
                attemptId: row.attempt_id!,
                questionId,
                answer: input.answer
              },
              row.id
            );

            return {
              attempt: result,
              slotId: refill(row),
              projectId: row.project_id,
              epoch: row.epoch,
              questionId
            };
          }
        }),
        retry: storeMutation({
          changes: ['learning'],
          input: retryPracticeQuestionInputSchema,
          output: Schema.Struct({ slot: practiceSlotSchema, requested: Schema.Boolean }),
          run: (input) => {
            const found = db.orm.select().from(slots).where(eq(slots.id, input.slotId)).get();

            const row = assertRetrySlot(found);

            const scope = db.orm
              .select()
              .from(s.material_generation_scopes)
              .where(eq(s.material_generation_scopes.id, row.epoch))
              .get();

            if (scope && (!scope.enabled || scope.project_id !== row.project_id))
              invalid('practice generation scope is closed');

            const failure = failureKind(row);

            if (!failure) {
              if (row.generation_attempt > 0n) return { slot: view(row, null), requested: false };

              invalid('practice slot has not failed');
            }

            if (!row.failure_kind)
              db.orm.update(slots).set({ failure_kind: failure }).where(eq(slots.id, row.id)).run();

            const updated = requireRow(
              db.orm
                .update(slots)
                .set({ generation_attempt: row.generation_attempt + 1n, failure_kind: null })
                .where(eq(slots.id, row.id))
                .returning()
                .get()
            );

            return { slot: view(updated, null), requested: true };
          }
        }),
        fail: storeMutation({
          changes: ['learning'],
          input: Schema.Struct({
            slotId: Schema.String,
            projectId: projectIdSchema,
            generationEventId: Schema.String,
            errorKind: errorKindSchema
          }),
          output: Schema.Boolean,
          run: (input) => {
            const row = db.orm.select().from(slots).where(eq(slots.id, input.slotId)).get();

            if (
              !row ||
              row.project_id !== input.projectId ||
              row.status !== 'pending' ||
              generationEventId(row) !== input.generationEventId
            )
              return false;

            const current = control(row.project_id);

            if (!current?.enabled || current.epoch !== row.epoch) return false;

            db.orm
              .update(slots)
              .set({ failure_kind: input.errorKind })
              .where(eq(slots.id, row.id))
              .run();

            return true;
          }
        })
      }
    };
  }
});

/** Compares retry payloads with the committed answer, treating choice selections as an unordered set. */
function sameAnswer(
  previous: (typeof quizAttemptSchema.Type)['questions'][number]['answer'],
  answer: (typeof answerPracticeQuestionInputSchema.Type)['answer']
) {
  return previous?.type === 'open' && answer.type === 'open'
    ? previous.answer === answer.answer
    : previous?.type === 'choice' && answer.type === 'choice'
      ? previous.choiceIds.length === answer.choiceIds.length &&
        previous.choiceIds.every((id) => answer.type === 'choice' && answer.choiceIds.includes(id))
      : false;
}
