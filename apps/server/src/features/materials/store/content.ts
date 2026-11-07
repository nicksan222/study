/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists canonical diagram, quiz and flashcard bodies for learning versions.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Persists canonical diagram, quiz and flashcard bodies for learning versions.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside its feature; callers own transaction scope. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { MaterialVersionId } from '@study/contracts/ids';
import type { MaterialContentInput } from '@study/contracts/materials/schemas';
import { and, eq } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeContent({ db: store }: StoreResources) {
  function insertContent(
    version: typeof s.material_versions.$inferSelect,
    content: MaterialContentInput
  ) {
    switch (content.kind) {
      case 'diagram':
        insertDiagram(version, content);
        break;
      case 'quiz':
        insertQuiz(version, content);
        break;
      case 'flashcards':
        insertFlashcards(version, content);
        break;
    }
  }

  function insertDiagram(
    version: typeof s.material_versions.$inferSelect,
    c: Extract<MaterialContentInput, { kind: 'diagram' }>
  ) {
    const db = store.orm,
      id = version.id;

    db.insert(s.material_diagram_versions)
      .values({
        version_id: id,
        format: c.format,
        payload: c.payload
      })
      .run();
  }

  /** Stores quiz questions with either typed reference answers or choices under the owning draft version. */
  function insertQuiz(
    version: typeof s.material_versions.$inferSelect,
    c: Extract<MaterialContentInput, { kind: 'quiz' }>
  ) {
    const db = store.orm,
      id = version.id;

    db.insert(s.material_quiz_versions)
      .values({
        version_id: id
      })
      .run();
    c.questions.forEach((q, i) => {
      const row = db
        .insert(s.material_quiz_questions)
        .values({
          version_id: id,
          position: BigInt(i),
          kind: q.kind,
          prompt: q.prompt,
          explanation: q.explanation
        })
        .returning()
        .get();

      if ('referenceAnswer' in q)
        db.insert(s.material_quiz_open_answers)
          .values({
            question_id: row.id,
            kind: q.kind,
            reference_answer: q.referenceAnswer
          })
          .run();
      else
        q.choices.forEach((choice, j) =>
          db
            .insert(s.material_quiz_choices)
            .values({
              question_id: row.id,
              question_kind: q.kind,
              position: BigInt(j),
              text: choice.text,
              is_correct: choice.isCorrect
            })
            .run()
        );
    });
  }

  function insertFlashcards(
    version: typeof s.material_versions.$inferSelect,
    c: Extract<MaterialContentInput, { kind: 'flashcards' }>
  ) {
    const db = store.orm,
      id = version.id;

    db.insert(s.material_flashcard_versions)
      .values({
        version_id: id,
        material_id: version.material_id
      })
      .run();
    c.cards.forEach((card, i) => {
      let cardId = card.cardId;

      if (cardId !== undefined) {
        if (
          !db
            .select()
            .from(s.material_card_identities)
            .where(
              and(
                eq(s.material_card_identities.id, cardId),
                eq(s.material_card_identities.material_id, version.material_id)
              )
            )
            .get()
        )
          throw new StudyError('invalid_input', 'Card identity belongs to another material');
      } else
        cardId = db
          .insert(s.material_card_identities)
          .values({
            material_id: version.material_id
          })
          .returning()
          .get().id;

      db.insert(s.material_flashcard_entries)
        .values({
          version_id: id,
          material_id: version.material_id,
          card_id: cardId,
          position: BigInt(i),
          front: card.front,
          back: card.back
        })
        .run();
    });
  }

  function removeContent(id: MaterialVersionId) {
    const db = store.orm;

    db.delete(s.material_evidence_citations)
      .where(eq(s.material_evidence_citations.version_id, id))
      .run();
    db.delete(s.material_evidence_inputs)
      .where(eq(s.material_evidence_inputs.version_id, id))
      .run();

    for (const q of db
      .select()
      .from(s.material_quiz_questions)
      .where(eq(s.material_quiz_questions.version_id, id))
      .all()) {
      db.delete(s.material_quiz_choices).where(eq(s.material_quiz_choices.question_id, q.id)).run();
      db.delete(s.material_quiz_open_answers)
        .where(eq(s.material_quiz_open_answers.question_id, q.id))
        .run();
    }

    db.delete(s.material_quiz_questions).where(eq(s.material_quiz_questions.version_id, id)).run();
    db.delete(s.material_flashcard_entries)
      .where(eq(s.material_flashcard_entries.version_id, id))
      .run();

    for (const table of [
      s.material_diagram_versions,
      s.material_quiz_versions,
      s.material_flashcard_versions
    ])
      db.delete(table).where(eq(table.version_id, id)).run();
  }

  return { insertContent, removeContent };
}
