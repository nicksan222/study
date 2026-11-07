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

import { quizChoiceIdSchema } from '@study/contracts/ids';
import { defaultQuizSettings } from '@study/contracts/settings/types';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Schema } from 'effect';
import { assert } from 'vite-plus/test';

import { Documents } from '#server/features/documents/index';
import { Materials } from '#server/features/materials/index';
import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { Learning } from './index.ts';

testStable(
  'boolean attempts reject invalid responses, resume and deterministically review both verdicts',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const domain = Learning.layer.pipe(
      Layer.provideMerge(Settings.layer),
      Layer.provideMerge(Materials.layer),
      Layer.provideMerge(Documents.layer),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials;
          const learning = yield* Learning;
          const material = yield* materials.create({
            title: 'Energy',
            publish: true,
            content: {
              kind: 'quiz',
              questions: [
                {
                  kind: 'true_false',
                  prompt: 'ATP carries energy.',
                  isTrue: true,
                  explanation: 'ATP is an energy carrier.'
                },
                {
                  kind: 'open',
                  prompt: 'Explain ATP',
                  referenceAnswer: 'Energy',
                  explanation: 'Energy'
                }
              ]
            }
          });

          for (const correct of [true, false]) {
            const attempt = yield* learning.startQuiz({
              versionId: material.version.id,
              configuration: { ...defaultQuizSettings, questionKind: 'true_false' }
            });

            assert.equal(attempt.questions.length, 1);
            const question = attempt.questions[0]!;

            assert.ok(question.kind === 'true_false');
            assert.ok(!('explanation' in question));
            assert.ok(question.choices.every((c) => !('isCorrect' in c)));

            for (const answer of [
              { type: 'open' as const, answer: 'true' },
              { type: 'choice' as const, choiceIds: question.choices.map((c) => c.id) },
              {
                type: 'choice' as const,
                choiceIds: [Schema.decodeUnknownSync(quizChoiceIdSchema)(999999n)]
              }
            ]) {
              const failure = yield* Effect.flip(
                learning.answerQuestion({ attemptId: attempt.id, questionId: question.id, answer })
              );

              assert.equal(failure.kind, 'invalid_input');
            }

            const choiceIds = [
              question.choices.find((c) => c.text === (correct ? 'true' : 'false'))!.id
            ];

            yield* learning.answerQuestion({
              attemptId: attempt.id,
              questionId: question.id,
              answer: { type: 'choice', choiceIds }
            });
            assert.deepEqual((yield* learning.attempt(attempt.id)).questions[0]?.answer, {
              type: 'choice',
              choiceIds
            });
            const finished = yield* learning.finishQuiz({ attemptId: attempt.id });

            assert.equal(finished.scoring.score, correct ? 1 : 0);
            const result = finished.questions[0]!;

            assert.ok(result.kind === 'true_false');
            assert.equal(result.choices.find((c) => c.isCorrect)?.text, 'true');
            assert.equal(result.explanation, 'ATP is an energy carrier.');
            assert.deepEqual(yield* learning.attempt(attempt.id), finished);
          }
        }).pipe(Effect.provide(domain))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
