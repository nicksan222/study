import { randomUUID, randomBytes } from 'node:crypto';

import { matchingTermIdSchema, matchingDefinitionIdSchema } from '@study/contracts/ids';
import { quizOrderingItemIdSchema } from '@study/contracts/ids';
import { materialContentInputSchema } from '@study/contracts/materials/schemas';
import { eq } from '@study/db';
import {
  materials,
  material_versions,
  project_materials,
  material_flashcard_versions,
  material_card_identities,
  material_flashcard_entries,
  material_quiz_versions,
  material_quiz_questions,
  material_quiz_choices,
  material_quiz_ordering_items,
  material_quiz_open_answers,
  material_diagram_versions
} from '@study/db/schema';
import { Schema } from 'effect';

import type { MaterialFixture } from '../types.ts';
import type { ProjectHarness } from './scope.ts';

type Content = typeof materialContentInputSchema.Type;

type Version = typeof material_versions.$inferSelect;

function seedCards(
  { db }: ProjectHarness,
  content: Extract<Content, { kind: 'flashcards' }>,
  version: Version
) {
  db.orm
    .insert(material_flashcard_versions)
    .values({ version_id: version.id, material_id: version.material_id })
    .run();

  for (const [position, { front, back }] of content.cards.entries()) {
    const card = db.orm
      .insert(material_card_identities)
      .values({ material_id: version.material_id })
      .returning()
      .get();

    db.orm
      .insert(material_flashcard_entries)
      .values({
        version_id: version.id,
        material_id: version.material_id,
        card_id: card.id,
        position: BigInt(position),
        front,
        back
      })
      .run();
  }
}

/** Seed canonical quiz content with fresh independent identities for matching terms and definitions. */
function seedQuiz(
  { db }: ProjectHarness,
  content: Extract<Content, { kind: 'quiz' }>,
  version: Version
) {
  db.orm.insert(material_quiz_versions).values({ version_id: version.id }).run();

  for (const [position, value] of content.questions.entries()) {
    const matchingPairs =
      value.kind === 'matching'
        ? value.pairs.map((pair) => ({
            ...pair,
            termId: Schema.decodeUnknownSync(matchingTermIdSchema)(randomUUID()),
            definitionId: Schema.decodeUnknownSync(matchingDefinitionIdSchema)(randomUUID())
          }))
        : null;

    const question = db.orm
      .insert(material_quiz_questions)
      .values({
        version_id: version.id,
        position: BigInt(position),
        kind: value.kind,
        prompt: value.prompt,
        explanation: value.explanation,
        matching_pairs: matchingPairs
      })
      .returning()
      .get();

    if (value.kind === 'ordering') {
      db.orm
        .insert(material_quiz_ordering_items)
        .values(
          value.items.map((item, position) => ({
            id: Schema.decodeUnknownSync(quizOrderingItemIdSchema)(
              randomBytes(8).readBigUInt64BE() & 0x7fffffffffffffffn || 1n
            ),
            question_id: question.id,
            position: BigInt(position),
            text: item.text
          }))
        )
        .run();
    } else if ('referenceAnswer' in value) {
      db.orm
        .insert(material_quiz_open_answers)
        .values({
          question_id: question.id,
          kind: value.kind,
          reference_answer: value.referenceAnswer
        })
        .run();
    } else if (value.kind === 'true_false' || 'choices' in value) {
      for (const [index, option] of (value.kind === 'true_false'
        ? [
            { text: 'true', isCorrect: value.isTrue },
            { text: 'false', isCorrect: !value.isTrue }
          ]
        : value.choices
      ).entries()) {
        db.orm
          .insert(material_quiz_choices)
          .values({
            question_id: question.id,
            question_kind: value.kind,
            position: BigInt(index),
            text: option.text,
            is_correct: option.isCorrect
          })
          .run();
      }
    }
  }
}

function createMaterial(scope: ProjectHarness, fixture: MaterialFixture) {
  const { db, projectId, time } = scope;
  const content = Schema.decodeUnknownSync(materialContentInputSchema)(fixture.content);
  const material = db.orm
    .insert(materials)
    .values({
      kind: content.kind,
      title: fixture.title,
      created_at: time,
      updated_at: time
    })
    .returning()
    .get();
  const version = db.orm
    .insert(material_versions)
    .values({
      material_id: material.id,
      kind: content.kind,
      number: 1n,
      created_at: time
    })
    .returning()
    .get();

  switch (content.kind) {
    case 'flashcards':
      seedCards(scope, content, version);
      break;
    case 'quiz':
      seedQuiz(scope, content, version);
      break;
    case 'diagram':
      db.orm
        .insert(material_diagram_versions)
        .values({
          version_id: version.id,
          format: content.format,
          payload: content.payload
        })
        .run();
      break;
  }

  db.orm
    .update(material_versions)
    .set({ status: 'published', published_at: time })
    .where(eq(material_versions.id, version.id))
    .run();
  db.orm
    .insert(project_materials)
    .values({ project_id: projectId, material_id: material.id })
    .run();
  scope.summary.materials++;

  return { id: material.id, projectId };
}

export function createQuiz(
  project: ProjectHarness,
  title: string,
  questions: readonly Extract<Content, { kind: 'quiz' }>['questions'][number][]
) {
  return createMaterial(project, { title, content: { kind: 'quiz', questions: [...questions] } });
}

export function createFlashcards(
  project: ProjectHarness,
  title: string,
  cards: readonly (readonly [string, string])[]
) {
  return createMaterial(project, {
    title,
    content: { kind: 'flashcards', cards: cards.map(([front, back]) => ({ front, back })) }
  });
}

export function createDiagram(project: ProjectHarness, title: string, payload: string) {
  return createMaterial(project, {
    title,
    content: { kind: 'diagram', format: 'mermaid', payload }
  });
}
