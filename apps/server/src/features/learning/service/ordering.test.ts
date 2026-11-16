import { quizOrderingItemIdSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies ordering practice persistence and deterministic grading behavior.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Tests answer secrecy, filtering and saved learner permutations.                        │
 * │ - Exercises immutable answers and real SQLite ownership guards.                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses feature services and real database records without model execution.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { orderingAnswerJsonSchema } from '@study/contracts';
import { materialAidExportSchema } from '@study/contracts';
import { defaultQuizSettings } from '@study/contracts';
import { eq, sql } from '@study/db';
import * as s from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer, Schema } from 'effect';

import { Materials } from '#server/features/materials/index';
import { Pages } from '#server/features/pages/index';
import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { Learning } from './index.ts';

test.stable(
  'ordering attempts hide canonical order, restore permutations and grade exactly',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const domain = Learning.layer.pipe(
      Layer.provideMerge(Settings.layer),
      Layer.provideMerge(Materials.layer),
      Layer.provideMerge(Pages.layer),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    let closed = false;

    try {
      const completedAttempts = await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials;
          const learning = yield* Learning;
          const material = yield* materials.create({
            title: 'Cycle',
            publish: true,
            content: {
              kind: 'quiz',
              questions: [
                {
                  kind: 'ordering',
                  prompt: 'Order the process.',
                  explanation: 'First A, then B, then C. [1]',
                  items: [{ text: 'A' }, { text: 'B' }, { text: 'C' }]
                },
                {
                  kind: 'ordering',
                  prompt: 'Another process.',
                  explanation: 'X before Y.',
                  items: [{ text: 'X' }, { text: 'Y' }]
                }
              ]
            }
          });
          const version = yield* materials.materialVersion({ id: material.version.id });

          test.assert.ok(version.content.kind === 'quiz');
          const canonical = version.content.questions[0]!;

          test.assert.ok(canonical.kind === 'ordering');

          for (const format of ['aid_json', 'csv'] as const) {
            const file = yield* materials.exportMaterialVersion({
              id: material.version.id,
              format
            });
            const text = new TextDecoder().decode(file.bytes);

            test.assert.ok(text.includes('ordering'));
            test.assert.ok(text.includes('A'));

            if (format === 'aid_json') {
              const exported = Schema.decodeUnknownSync(
                Schema.fromJsonString(Schema.toCodecJson(materialAidExportSchema))
              )(text);

              test.assert.deepEqual(exported.version.content, version.content);
            }
          }

          const correct = canonical.items.map((item) => item.id);
          const other = version.content.questions[1]!;

          test.assert.ok(other.kind === 'ordering');

          const snapshots = [];

          for (const permutation of [
            correct,
            [correct[1]!, correct[0]!, correct[2]!],
            [...correct].reverse()
          ]) {
            const attempt = yield* learning.startQuiz({
              versionId: material.version.id,
              configuration: {
                ...defaultQuizSettings,
                questionKind: 'ordering',
                questionCount: 1,
                shuffleChoices: false
              }
            });
            const question = attempt.questions[0]!;

            test.assert.ok(question.kind === 'ordering');
            test.assert.ok(!('explanation' in question));
            test.assert.ok(!('correctItemIds' in question));
            test.assert.deepEqual(Object.keys(question.items[0]!).sort(), ['id', 'text']);
            test.assert.deepEqual(
              (yield* learning.attempt(attempt.id)).questions,
              attempt.questions
            );

            for (const itemIds of [
              correct.slice(1),
              [correct[0]!, correct[1]!, other.items[0]!.id],
              [correct[0]!, correct[0]!, correct[2]!],
              [
                correct[0]!,
                correct[1]!,
                Schema.decodeUnknownSync(quizOrderingItemIdSchema)(9223372036854775807n)
              ]
            ]) {
              const error = yield* Effect.flip(
                learning.answerQuestion({
                  attemptId: attempt.id,
                  questionId: question.id,
                  answer: { type: 'ordering', itemIds }
                })
              );

              test.assert.equal(error.kind, 'invalid_input');
            }

            test.assert.equal(
              (yield* Effect.flip(
                learning.answerQuestion({
                  attemptId: attempt.id,
                  questionId: question.id,
                  answer: { type: 'open', answer: 'A B C' }
                })
              )).kind,
              'invalid_input'
            );
            yield* learning.answerQuestion({
              attemptId: attempt.id,
              questionId: question.id,
              answer: { type: 'ordering', itemIds: permutation }
            });
            test.assert.deepEqual((yield* learning.attempt(attempt.id)).questions[0]!.answer, {
              type: 'ordering',
              itemIds: permutation
            });
            test.assert.throws(() =>
              context.db.orm
                .update(s.material_quiz_responses)
                .set({ answer: '{"type":"ordering","itemIds":["1","1"]}' })
                .where(eq(s.material_quiz_responses.attempt_id, attempt.id))
                .run()
            );
            const completed = yield* learning.finishQuiz({ attemptId: attempt.id });

            test.assert.equal(completed.scoring.complete, true);
            test.assert.equal(completed.scoring.score, permutation === correct ? 1 : 0);
            const result = completed.questions[0]!;

            test.assert.ok(result.kind === 'ordering');
            test.assert.deepEqual(result.correctItemIds, correct);
            test.assert.equal(result.explanation, canonical.explanation);
            test.assert.throws(() =>
              context.db.orm
                .update(s.material_quiz_responses)
                .set({ score: 0.5 })
                .where(eq(s.material_quiz_responses.attempt_id, attempt.id))
                .run()
            );
            test.assert.throws(() =>
              context.db.orm
                .update(s.material_quiz_ordering_items)
                .set({ text: 'Changed' })
                .where(eq(s.material_quiz_ordering_items.question_id, question.id))
                .run()
            );
            test.assert.deepEqual(context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
            snapshots.push(completed);
          }

          return snapshots;
        }).pipe(Effect.provide(domain))
      );

      context.close();
      closed = true;
      const reopened = await location.open();

      try {
        for (const attempt of completedAttempts) {
          const response = reopened.orm
            .select()
            .from(s.material_quiz_responses)
            .where(eq(s.material_quiz_responses.attempt_id, attempt.id))
            .get();

          test.assert.ok(response);
          test.assert.deepEqual(
            Schema.decodeUnknownSync(orderingAnswerJsonSchema)(response.answer),
            attempt.questions[0]!.answer
          );
        }

        test.assert.deepEqual(reopened.orm.all(sql`PRAGMA foreign_key_check`), []);
      } finally {
        reopened.close();
      }
    } finally {
      if (!closed) context.close();

      await location.cleanup();
    }
  }
);
