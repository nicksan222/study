/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies true or false persistence and deterministic grading behavior.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Tests answer secrecy, exact filters and deterministic scoring.                         │
 * │ - Exercises canonical exports, saved history and SQLite persistence.                     │
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

import { Materials } from '#server/features/materials/index';
import { Pages } from '#server/features/pages/index';
import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { Learning } from './index.ts';

for (const truth of [true, false])
  testStable(
    `${truth ? 'True' : 'False'} statement attempts validate responses, resume and review both verdicts`,
    async () => {
      const location = await createTestDatabase();
      const context = new ServerContext(await location.open());
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
              title: 'Energy',
              publish: true,
              content: {
                kind: 'quiz',
                questions: [
                  {
                    kind: 'true_false',
                    prompt: truth ? 'ATP carries energy.' : 'DNA is the immediate energy carrier.',
                    isTrue: truth,
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

            for (const format of ['aid_json', 'csv'] as const) {
              const exported = yield* materials.exportMaterialVersion({
                id: material.version.id,
                format
              });

              assert.ok(new TextDecoder().decode(exported.bytes).includes('true_false'));
            }

            for (const correct of [true, false]) {
              const attempt = yield* learning.startQuiz({
                versionId: material.version.id,
                configuration: { ...defaultQuizSettings, questionKind: 'true_false' }
              });

              assert.equal(attempt.questions.length, 1);
              const question = attempt.questions[0]!;

              assert.ok(question.kind === 'true_false');
              assert.ok(!('explanation' in question));
              assert.ok(!('score' in question));
              assert.ok(question.choices.every((c) => !('isCorrect' in c)));

              for (const answer of [
                { type: 'open' as const, answer: 'true' },
                {
                  type: 'choice' as const,
                  choiceIds: [question.choices[0]!.id, question.choices[0]!.id]
                },
                { type: 'choice' as const, choiceIds: question.choices.map((c) => c.id) },
                {
                  type: 'choice' as const,
                  choiceIds: [Schema.decodeUnknownSync(quizChoiceIdSchema)(999999n)]
                }
              ]) {
                const failure = yield* Effect.flip(
                  learning.answerQuestion({
                    attemptId: attempt.id,
                    questionId: question.id,
                    answer
                  })
                );

                assert.equal(failure.kind, 'invalid_input');
              }

              const choiceIds = [
                question.choices.find((c) => c.text === (correct === truth ? 'true' : 'false'))!.id
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
              assert.equal(result.choices.find((c) => c.isCorrect)?.text, truth ? 'true' : 'false');
              assert.equal(result.explanation, 'ATP is an energy carrier.');
              assert.deepEqual(yield* learning.attempt(attempt.id), finished);
              const history = yield* learning.attempts({ materialId: material.id, limit: 50 });

              assert.ok(
                history.items.some(
                  (item) => item.attempt.id === attempt.id && item.attempt.status === 'completed'
                )
              );
            }
          }).pipe(Effect.provide(domain))
        );
      } finally {
        context.close();
        await location.cleanup();
      }
    }
  );
