import { and, eq } from '@study/db';
import * as s from '@study/db/schema';

import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { MaterialContentInput } from '#server/shared/materials/schemas';

import { required } from './reads.ts';

export function insertContent(
  store: ServerContext,
  version: typeof s.material_versions.$inferSelect,
  c: MaterialContentInput
) {
  const db = store.db.orm,
    id = version.id;

  if ('sourceId' in c) {
    const source = required(db.select().from(s.sources).where(eq(s.sources.id, c.sourceId)).get());

    if (source.project_id !== version.project_id)
      throw new StudyError('invalid_input', 'Source belongs to another project');
  }

  switch (c.kind) {
    case 'diagram':
      db.insert(s.material_diagram_versions)
        .values({ version_id: id, format: c.format, payload: c.payload })
        .run();
      break;
    case 'file':
      db.insert(s.material_file_versions).values({ version_id: id, source_id: c.sourceId }).run();
      break;
    case 'link':
      db.insert(s.material_link_versions).values({ version_id: id, source_id: c.sourceId }).run();
      break;
    case 'audio':
      db.insert(s.material_audio_versions)
        .values({
          version_id: id,
          source_id: c.sourceId,
          duration_ms: c.durationMs,
          sample_rate: c.sampleRate,
          channels: c.channels
        })
        .run();
      break;
    case 'video':
      db.insert(s.material_video_versions)
        .values({
          version_id: id,
          source_id: c.sourceId,
          duration_ms: c.durationMs,
          width: c.width,
          height: c.height
        })
        .run();
      break;
    case 'image':
      db.insert(s.material_image_versions)
        .values({ version_id: id, source_id: c.sourceId, width: c.width, height: c.height })
        .run();
      break;
    case 'document': {
      const doc = db
        .insert(s.documents)
        .values({
          source_id: null,
          extractor: null,
          extractor_version: BigInt(c.meta.extractorVersion),
          meta: JSON.stringify(c.meta),
          created_at: version.created_at
        })
        .returning()
        .get();

      c.blocks.forEach((b, i) =>
        db
          .insert(s.blocks)
          .values({
            document_id: doc.id,
            ordinal: BigInt(i),
            kind: b.kind,
            text: b.text,
            anchor: JSON.stringify(b.anchor)
          })
          .run()
      );
      db.insert(s.material_document_versions).values({ version_id: id, document_id: doc.id }).run();
      break;
    }
    case 'quiz': {
      db.insert(s.material_quiz_versions).values({ version_id: id }).run();
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

        if (q.kind === 'open')
          db.insert(s.material_quiz_open_answers)
            .values({ question_id: row.id, reference_answer: q.referenceAnswer })
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
      break;
    }
    case 'flashcards': {
      db.insert(s.material_flashcard_versions)
        .values({ version_id: id, material_id: version.material_id })
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
            .values({ material_id: version.material_id })
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
      break;
    }
  }
}

export function removeContent(store: ServerContext, id: bigint) {
  const db = store.db.orm;
  const doc = db
    .select()
    .from(s.material_document_versions)
    .where(eq(s.material_document_versions.version_id, id))
    .get();

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
    s.material_file_versions,
    s.material_audio_versions,
    s.material_video_versions,
    s.material_image_versions,
    s.material_link_versions,
    s.material_document_versions,
    s.material_diagram_versions,
    s.material_quiz_versions,
    s.material_flashcard_versions
  ])
    db.delete(table).where(eq(table.version_id, id)).run();

  if (
    doc &&
    db.select().from(s.documents).where(eq(s.documents.id, doc.document_id)).get()?.source_id ===
      null
  ) {
    db.delete(s.blocks).where(eq(s.blocks.document_id, doc.document_id)).run();
    db.delete(s.documents).where(eq(s.documents.id, doc.document_id)).run();
  }
}
