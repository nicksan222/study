import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';

import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { fixture } from '#testing/procedures';

import { learningRouter } from './router.ts';

export async function setup(t: TestContext) {
  const f = await fixture(t);
  const project = await f.caller.projects.createProject({ name: 'Learning' });

  return { ...f, project, learning: learningRouter.createCaller(f.context) };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

export function seedQuiz(f: Fixture, materialId?: bigint, publish = true, questionCount = 3) {
  return f.store.transaction(() => {
    const orm = f.store.db.orm,
      at = 1n;
    const material =
      materialId ??
      orm
        .insert(s.materials)
        .values({
          project_id: f.project.id,
          kind: 'quiz',
          title: 'Quiz',
          created_at: at,
          updated_at: at
        })
        .returning()
        .get()!.id;
    const existing = orm
      .select()
      .from(s.material_versions)
      .where(eq(s.material_versions.material_id, material))
      .all();
    const version = orm
      .insert(s.material_versions)
      .values({
        material_id: material,
        project_id: f.project.id,
        kind: 'quiz',
        number: BigInt(existing.length + 1),
        created_at: at
      })
      .returning()
      .get()!;

    orm.insert(s.material_quiz_versions).values({ version_id: version.id }).run();
    const kinds = ['single_choice', 'multiple_choice', 'open'] as const;
    const questions = Array.from({ length: questionCount }, (_, i) => kinds[i % kinds.length]!).map(
      (kind, i) =>
        orm
          .insert(s.material_quiz_questions)
          .values({
            version_id: version.id,
            position: BigInt(i),
            kind,
            prompt: kind,
            explanation: 'secret explanation'
          })
          .returning()
          .get()!
    );
    const choices = questions
      .filter((q) => q.kind !== 'open')
      .map((q) =>
        [true, q.kind === 'multiple_choice', false].map((is_correct, i) => ({
          ...orm
            .insert(s.material_quiz_choices)
            .values({
              question_id: q.id,
              question_kind: q.kind as 'single_choice' | 'multiple_choice',
              position: BigInt(i),
              text: 'Choice ' + i,
              is_correct
            })
            .returning()
            .get()!,
          is_correct
        }))
      );

    orm
      .insert(s.material_quiz_open_answers)
      .values(
        questions
          .filter((q) => q.kind === 'open')
          .map((q) => ({
            question_id: q.id,
            reference_answer: 'secret reference'
          }))
      )
      .run();

    if (publish)
      orm
        .update(s.material_versions)
        .set({ status: 'published', published_at: at })
        .where(eq(s.material_versions.id, version.id))
        .run();

    return { materialId: material, versionId: version.id, questions, choices };
  });
}

export function seedDeck(
  f: Fixture,
  previous?: { materialId: bigint; cardId: bigint },
  count = 1,
  publish = true
) {
  return f.store.transaction(() => {
    const orm = f.store.db.orm,
      at = 1n;
    const material =
      previous?.materialId ??
      orm
        .insert(s.materials)
        .values({
          project_id: f.project.id,
          kind: 'flashcards',
          title: 'Deck',
          created_at: at,
          updated_at: at
        })
        .returning()
        .get()!.id;
    const existing = orm
      .select()
      .from(s.material_versions)
      .where(eq(s.material_versions.material_id, material))
      .all();
    const version = orm
      .insert(s.material_versions)
      .values({
        material_id: material,
        project_id: f.project.id,
        kind: 'flashcards',
        number: BigInt(existing.length + 1),
        created_at: at
      })
      .returning()
      .get()!;

    orm
      .insert(s.material_flashcard_versions)
      .values({ version_id: version.id, material_id: material })
      .run();
    const ids = Array.from({ length: count }, (_, i) =>
      i === 0 && previous
        ? previous.cardId
        : orm
            .insert(s.material_card_identities)
            .values({ material_id: material })
            .returning()
            .get()!.id
    );

    ids.forEach((card_id, i) =>
      orm
        .insert(s.material_flashcard_entries)
        .values({
          version_id: version.id,
          material_id: material,
          card_id,
          position: BigInt(i),
          front: 'Front ' + existing.length,
          back: 'Back ' + existing.length
        })
        .run()
    );

    if (publish)
      orm
        .update(s.material_versions)
        .set({ status: 'published', published_at: at })
        .where(eq(s.material_versions.id, version.id))
        .run();

    return { materialId: material, versionId: version.id, cardId: ids[0]!, cardIds: ids };
  });
}

export function noLeaks(value: unknown) {
  const inspect = (v: unknown) => {
    if (!v || typeof v !== 'object') return;

    for (const [key, child] of Object.entries(v)) {
      assert.ok(
        ![
          'is_correct',
          'isCorrect',
          'reference_answer',
          'referenceAnswer',
          'explanation',
          'score',
          'feedback'
        ].includes(key),
        key + ' leaked'
      );
      inspect(child);
    }
  };

  inspect(value);
}
