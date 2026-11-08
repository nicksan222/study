/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies fill-in-the-blank practice persistence and durable grading behavior.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Tests answer secrecy, filtering and delayed grade publication.                         │
 * │ - Exercises immutable answers and real SQLite ownership guards.                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses feature services and real database records without model execution.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defaultQuizSettings } from '@study/contracts/settings/types';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { assert } from 'vite-plus/test';

import { Materials } from '#server/features/materials/index';
import { Pages } from '#server/features/pages/index';
import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { decodeEvent } from '#server/platform/workflows/events';

import { Learning } from './index.ts';

testStable(
  'blank practice persists, hides answers, filters kinds and settles a grade after completion',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const domain = Learning.layer.pipe(
      Layer.provideMerge(Settings.layer),
      Layer.provideMerge(Materials.layer),
      Layer.provideMerge(Pages.layer),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials;
          const learning = yield* Learning;
          const material = yield* materials.create({
            title: 'Cell recall',
            publish: true,
            content: {
              kind: 'quiz',
              questions: [
                {
                  kind: 'fill_blank',
                  prompt: 'In cell_model, the powerhouse is the ____.',
                  referenceAnswer: 'mitochondrion',
                  explanation: 'It produces ATP.'
                },
                {
                  kind: 'open',
                  prompt: 'Explain ATP.',
                  referenceAnswer: 'Energy carrier',
                  explanation: 'It carries energy.'
                }
              ]
            }
          });
          const detail = yield* materials.materialVersion({ id: material.version.id });

          assert.ok(detail.content.kind === 'quiz');
          assert.ok(detail.content.questions[0]?.kind === 'fill_blank');
          assert.equal(detail.content.questions[0].referenceAnswer, 'mitochondrion');
          const configuration = { ...defaultQuizSettings, questionKind: 'fill_blank' as const };
          const attempt = yield* learning.startQuiz({
            versionId: material.version.id,
            configuration
          });

          assert.equal(attempt.questions.length, 1);
          const question = attempt.questions[0]!;

          assert.equal(question.kind, 'fill_blank');
          assert.ok(!('referenceAnswer' in question));
          assert.ok(!('explanation' in question));
          assert.equal(
            (yield* Effect.flip(
              learning.answerQuestion({
                attemptId: attempt.id,
                questionId: question.id,
                answer: { type: 'choice', choiceIds: [] }
              })
            )).kind,
            'invalid_input'
          );
          yield* learning.answerQuestion({
            attemptId: attempt.id,
            questionId: question.id,
            answer: { type: 'open', answer: 'mitochondrion' }
          });
          const restored = yield* learning.attempt(attempt.id);

          assert.deepEqual(restored.questions[0]?.answer, {
            type: 'open',
            answer: 'mitochondrion'
          });
          const event = decodeEvent(
            context.db.orm
              .select()
              .from(s.workflowEvents)
              .all()
              .find((row) => row.type === 'QuizAnswerSubmitted')!.payload
          );

          assert.ok(event.type === 'QuizAnswerSubmitted');
          const snapshot = yield* learning.gradingSnapshot(event);

          assert.equal(snapshot.referenceAnswer, 'mitochondrion');
          assert.equal(snapshot.learnerAnswer, 'mitochondrion');
          const finished = yield* learning.finishQuiz({ attemptId: attempt.id });

          assert.equal(finished.scoring.complete, false);
          // The workflow uses the private settlement operation when grading finishes after completion.
          const { AttemptStore } = yield* Effect.promise(
            () => import('#server/features/learning/store/index')
          );
          const { transaction } = yield* Effect.promise(
            () => import('#server/platform/definitions/define-store')
          );

          yield* transaction((tx) =>
            tx.store(AttemptStore).publishGrade({
              attemptId: attempt.id,
              questionId: question.id,
              expectedAnswerHash: event.answerHash,
              score: 1,
              feedback: 'Correct.'
            })
          );
          const completed = yield* learning.attempt(attempt.id);

          assert.ok(completed.status === 'completed');
          assert.equal(completed.scoring.score, 1);
          const result = completed.questions[0]!;

          assert.ok(result.kind === 'fill_blank');
          assert.equal(result.referenceAnswer, 'mitochondrion');
          assert.equal(result.feedback, 'Correct.');
          yield* transaction((tx) =>
            tx.store(AttemptStore).publishGrade({
              attemptId: attempt.id,
              questionId: question.id,
              expectedAnswerHash: event.answerHash,
              score: 0,
              feedback: 'Changed.'
            })
          );
          const unchanged = yield* learning.attempt(attempt.id);

          assert.ok(unchanged.status === 'completed');
          assert.equal(unchanged.scoring.score, 1);
          assert.throws(() =>
            context.db.orm
              .update(s.material_quiz_responses)
              .set({ score: 0 })
              .where(eq(s.material_quiz_responses.attempt_id, attempt.id))
              .run()
          );
          const open = yield* learning.startQuiz({
            versionId: material.version.id,
            configuration: { ...configuration, questionKind: 'open' }
          });

          assert.deepEqual(
            open.questions.map((q) => q.kind),
            ['open']
          );
          assert.deepEqual(context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
          assert.equal(
            context.db.orm
              .select()
              .from(s.material_quiz_responses)
              .where(eq(s.material_quiz_responses.attempt_id, attempt.id))
              .get()?.question_kind,
            'fill_blank'
          );
        }).pipe(Effect.provide(domain))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
