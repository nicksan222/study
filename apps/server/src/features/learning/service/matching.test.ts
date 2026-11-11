/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Tests matching persistence and grading using the real SQLite service boundary.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks answer secrecy, partial scores and malicious matching submissions.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private learning stores own matching behavior inside caller transactions.                │
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

import { Learning } from './index.ts';

testStable(
  'matching saves associations, hides mappings, grades each pair and rejects foreign permutations',
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
            title: 'Cell matching',
            publish: true,
            content: {
              kind: 'quiz',
              questions: [
                {
                  kind: 'matching',
                  prompt: 'Match each component.',
                  explanation: 'Distinct cell functions.',
                  pairs: [
                    { term: 'Nucleus', definition: 'Stores DNA' },
                    { term: 'Ribosome', definition: 'Builds proteins' },
                    { term: 'Mitochondrion', definition: 'Produces ATP' }
                  ]
                }
              ]
            }
          });

          assert.ok(material.version.content.kind === 'quiz');
          const canonical = material.version.content.questions[0]!;

          assert.ok(canonical.kind === 'matching');
          const csv = yield* materials.exportMaterialVersion({
            id: material.version.id,
            format: 'csv'
          });

          assert.ok(new TextDecoder().decode(csv.bytes).includes('Stores DNA'));
          const configuration = {
            ...defaultQuizSettings,
            questionKind: 'matching' as const,
            shuffleChoices: false
          };
          const attempt = yield* learning.startQuiz({
            versionId: material.version.id,
            configuration
          });
          const question = attempt.questions[0]!;

          assert.ok(question.kind === 'matching');
          assert.ok(!('pairs' in question));
          assert.ok(!('explanation' in question));
          assert.deepEqual(
            question.terms.map((t) => Object.keys(t).sort()),
            Array(3).fill(['id', 'text'])
          );
          assert.deepEqual(
            question.definitions.map((t) => Object.keys(t).sort()),
            Array(3).fill(['id', 'text'])
          );
          const definitionIds = new Set(question.definitions.map((d) => String(d.id)));

          assert.ok(question.terms.every((t) => !definitionIds.has(t.id)));

          const restored = yield* learning.attempt(attempt.id);

          assert.deepEqual(restored, attempt);
          const associations = canonical.pairs.map((p) => ({
            termId: p.termId,
            definitionId: p.definitionId
          }));
          const otherMaterial = yield* materials.create({
            title: 'Other',
            publish: true,
            content: {
              kind: 'quiz',
              questions: [
                {
                  kind: 'matching',
                  prompt: 'Other',
                  explanation: 'Other',
                  pairs: [
                    { term: 'A', definition: 'a' },
                    { term: 'B', definition: 'b' }
                  ]
                }
              ]
            }
          });

          assert.ok(otherMaterial.version.content.kind === 'quiz');
          const other = otherMaterial.version.content.questions[0]!;

          assert.ok(other.kind === 'matching');

          for (const invalid of [
            associations.slice(1),
            [associations[0]!, associations[0]!, associations[2]!],
            associations.map((a) => ({ ...a, definitionId: associations[0]!.definitionId })),
            [{ ...associations[0]!, termId: other.pairs[0]!.termId }, ...associations.slice(1)],
            [
              { ...associations[0]!, definitionId: other.pairs[0]!.definitionId },
              ...associations.slice(1)
            ]
          ]) {
            const error = yield* Effect.flip(
              learning.answerQuestion({
                attemptId: attempt.id,
                questionId: question.id,
                answer: { type: 'matching', associations: invalid }
              })
            );

            assert.equal(error.kind, 'invalid_input');
          }

          const pending = yield* learning.startQuiz({
            versionId: material.version.id,
            configuration
          });
          const valid = yield* learning.answerQuestion({
            attemptId: pending.id,
            questionId: question.id,
            answer: { type: 'matching', associations }
          });

          assert.ok(valid.status === 'in_progress');

          for (const malicious of [
            associations.slice(1),
            [associations[0], associations[0], associations[2]],
            [
              { ...associations[0], definitionId: other.pairs[0]!.definitionId },
              ...associations.slice(1)
            ]
          ])
            assert.throws(() =>
              context.db.orm
                .update(s.material_quiz_responses)
                .set({ answer: JSON.stringify(malicious) })
                .where(eq(s.material_quiz_responses.attempt_id, pending.id))
                .run()
            );

          assert.throws(() =>
            context.db.orm
              .update(s.material_quiz_attempt_questions)
              .set({ matching_order: [associations[0]!.definitionId] })
              .where(eq(s.material_quiz_attempt_questions.attempt_id, pending.id))
              .run()
          );
          const partial = associations.map((a, i) => ({
            ...a,
            definitionId: associations[i === 0 ? 1 : i === 1 ? 0 : i]!.definitionId
          }));

          yield* learning.answerQuestion({
            attemptId: attempt.id,
            questionId: question.id,
            answer: { type: 'matching', associations: partial }
          });
          assert.deepEqual((yield* learning.attempt(attempt.id)).questions[0]?.answer, {
            type: 'matching',
            associations: partial
          });
          const completed = yield* learning.finishQuiz({ attemptId: attempt.id });

          assert.equal(completed.scoring.score, 1 / 3);
          const result = completed.questions[0]!;

          assert.ok(result.kind === 'matching');
          assert.deepEqual(
            result.pairs.map((p) => p.score),
            [0, 0, 1]
          );
          assert.equal(result.explanation, canonical.explanation);
          assert.throws(() =>
            context.db.orm
              .update(s.material_quiz_responses)
              .set({ answer: '[]' })
              .where(eq(s.material_quiz_responses.attempt_id, attempt.id))
              .run()
          );

          for (const [offset, score] of [
            [0, 1],
            [1, 0]
          ] as const) {
            const next = yield* learning.startQuiz({
              versionId: material.version.id,
              configuration
            });

            yield* learning.answerQuestion({
              attemptId: next.id,
              questionId: question.id,
              answer: {
                type: 'matching',
                associations: associations.map((a, i) => ({
                  ...a,
                  definitionId: associations[(i + offset) % associations.length]!.definitionId
                }))
              }
            });
            assert.equal((yield* learning.finishQuiz({ attemptId: next.id })).scoring.score, score);
          }

          assert.equal(
            context.db.orm
              .select()
              .from(s.workflowEvents)
              .all()
              .filter((e) => e.type === 'QuizAnswerSubmitted').length,
            0
          );
          assert.deepEqual(context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
        }).pipe(Effect.provide(domain))
      );
      const reopened = await location.open();

      try {
        assert.equal(
          reopened.orm.select().from(s.material_quiz_questions).all()[0]?.matching_pairs?.length,
          3
        );
        assert.ok(
          reopened.orm
            .select()
            .from(s.material_quiz_attempt_questions)
            .all()
            .every((q) => q.matching_order?.length === 3)
        );
        assert.deepEqual(reopened.orm.all(sql`PRAGMA foreign_key_check`), []);
      } finally {
        reopened.close();
      }
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
