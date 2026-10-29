import { eq, and, asc, desc, sql, inArray } from '@study/db';
import * as s from '@study/db/schema';

import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type {
  MaterialDetailDto,
  MaterialSummaryDto,
  MaterialVersionDetailDto
} from '#server/shared/materials/schemas';

import { anchorSchema, documentSchema } from './schemas.ts';

type QuizQuestionDetailDto = Extract<
  MaterialVersionDetailDto,
  { kind: 'quiz' }
>['content']['questions'][number];

export function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new StudyError('not_found', 'Material resource missing');

  return value;
}

export function materialRow(store: ServerContext, id: bigint, active = false) {
  const row = required(store.db.orm.select().from(s.materials).where(eq(s.materials.id, id)).get());

  if (active && row.archived_at !== null)
    throw new StudyError('invalid_input', 'Material is archived');

  return row;
}

export function versionRow(store: ServerContext, id: bigint, draft = false) {
  const row = required(
    store.db.orm.select().from(s.material_versions).where(eq(s.material_versions.id, id)).get()
  );

  if (draft && row.status !== 'draft')
    throw new StudyError('invalid_input', 'Published versions are immutable');

  if (draft) materialRow(store, row.material_id, true);

  return row;
}

function readSource(store: ServerContext, id: bigint) {
  return required(store.db.orm.select().from(s.sources).where(eq(s.sources.id, id)).get());
}

export function readVersion(store: ServerContext, id: bigint): MaterialVersionDetailDto | null {
  const row = store.db.orm
    .select()
    .from(s.material_versions)
    .where(eq(s.material_versions.id, id))
    .get();

  if (!row) return null;

  const base = {
    ...row,
    inputs: store.db.orm
      .select()
      .from(s.material_version_inputs)
      .where(eq(s.material_version_inputs.version_id, id))
      .orderBy(asc(s.material_version_inputs.input_version_id))
      .all()
      .map((r) => r.input_version_id),
    parents: store.db.orm
      .select()
      .from(s.material_version_parents)
      .where(eq(s.material_version_parents.version_id, id))
      .orderBy(asc(s.material_version_parents.parent_version_id))
      .all()
      .map((r) => r.parent_version_id)
  };

  switch (row.kind) {
    case 'diagram': {
      const c = required(
        store.db.orm
          .select()
          .from(s.material_diagram_versions)
          .where(eq(s.material_diagram_versions.version_id, id))
          .get()
      );

      return {
        ...base,
        kind: row.kind,
        content: { kind: c.kind, format: c.format, payload: c.payload }
      };
    }
    case 'file': {
      const c = required(
        store.db.orm
          .select()
          .from(s.material_file_versions)
          .where(eq(s.material_file_versions.version_id, id))
          .get()
      );

      return {
        ...base,
        kind: row.kind,
        content: { kind: c.kind, sourceId: c.source_id, source: readSource(store, c.source_id) }
      };
    }
    case 'link': {
      const c = required(
        store.db.orm
          .select()
          .from(s.material_link_versions)
          .where(eq(s.material_link_versions.version_id, id))
          .get()
      );

      return {
        ...base,
        kind: row.kind,
        content: { kind: c.kind, sourceId: c.source_id, source: readSource(store, c.source_id) }
      };
    }
    case 'audio': {
      const c = required(
        store.db.orm
          .select()
          .from(s.material_audio_versions)
          .where(eq(s.material_audio_versions.version_id, id))
          .get()
      );

      return {
        ...base,
        kind: row.kind,
        content: {
          kind: c.kind,
          sourceId: c.source_id,
          source: readSource(store, c.source_id),
          durationMs: c.duration_ms,
          sampleRate: c.sample_rate,
          channels: c.channels
        }
      };
    }
    case 'video': {
      const c = required(
        store.db.orm
          .select()
          .from(s.material_video_versions)
          .where(eq(s.material_video_versions.version_id, id))
          .get()
      );

      return {
        ...base,
        kind: row.kind,
        content: {
          kind: c.kind,
          sourceId: c.source_id,
          source: readSource(store, c.source_id),
          durationMs: c.duration_ms,
          width: c.width,
          height: c.height
        }
      };
    }
    case 'image': {
      const c = required(
        store.db.orm
          .select()
          .from(s.material_image_versions)
          .where(eq(s.material_image_versions.version_id, id))
          .get()
      );

      return {
        ...base,
        kind: row.kind,
        content: {
          kind: c.kind,
          sourceId: c.source_id,
          source: readSource(store, c.source_id),
          width: c.width,
          height: c.height
        }
      };
    }
    case 'document': {
      const c = required(
        store.db.orm
          .select()
          .from(s.material_document_versions)
          .where(eq(s.material_document_versions.version_id, id))
          .get()
      );
      const doc = required(
        store.db.orm.select().from(s.documents).where(eq(s.documents.id, c.document_id)).get()
      );
      const blocks = store.db.orm
        .select()
        .from(s.blocks)
        .where(eq(s.blocks.document_id, doc.id))
        .orderBy(asc(s.blocks.ordinal))
        .all()
        .map((b) => ({
          kind: b.kind,
          text: b.text,
          anchor: anchorSchema.parse(JSON.parse(b.anchor))
        }));

      return {
        ...base,
        kind: row.kind,
        content: { kind: row.kind, ...documentSchema.parse({ blocks, meta: JSON.parse(doc.meta) }) }
      };
    }
    case 'quiz': {
      const choiceRows = store.db.orm
        .select({ choice: s.material_quiz_choices })
        .from(s.material_quiz_choices)
        .innerJoin(
          s.material_quiz_questions,
          eq(s.material_quiz_questions.id, s.material_quiz_choices.question_id)
        )
        .where(eq(s.material_quiz_questions.version_id, id))
        .orderBy(asc(s.material_quiz_choices.question_id), asc(s.material_quiz_choices.position))
        .all();
      const byQuestion = new Map<bigint, { id: bigint; text: string; isCorrect: boolean }[]>();

      for (const { choice: c } of choiceRows) {
        const group = byQuestion.get(c.question_id) ?? [];

        group.push({ id: c.id, text: c.text, isCorrect: c.is_correct });
        byQuestion.set(c.question_id, group);
      }

      const openRows = store.db.orm
        .select({
          questionId: s.material_quiz_open_answers.question_id,
          reference: s.material_quiz_open_answers.reference_answer
        })
        .from(s.material_quiz_open_answers)
        .innerJoin(
          s.material_quiz_questions,
          eq(s.material_quiz_questions.id, s.material_quiz_open_answers.question_id)
        )
        .where(eq(s.material_quiz_questions.version_id, id))
        .all();
      const references = new Map(openRows.map((r) => [r.questionId, r.reference]));
      const questions: QuizQuestionDetailDto[] = store.db.orm
        .select()
        .from(s.material_quiz_questions)
        .where(eq(s.material_quiz_questions.version_id, id))
        .orderBy(asc(s.material_quiz_questions.position))
        .all()
        .map((q) => {
          const questionBase = { id: q.id, prompt: q.prompt, explanation: q.explanation };

          if (q.kind === 'open')
            return {
              ...questionBase,
              kind: q.kind,
              referenceAnswer: required(references.get(q.id))
            };

          const choices = byQuestion.get(q.id) ?? [];

          if (q.kind === 'single_choice') return { ...questionBase, kind: q.kind, choices };

          return { ...questionBase, kind: q.kind, choices };
        });

      return { ...base, kind: row.kind, content: { kind: row.kind, questions } };
    }

    case 'flashcards': {
      const cards = store.db.orm
        .select()
        .from(s.material_flashcard_entries)
        .where(eq(s.material_flashcard_entries.version_id, id))
        .orderBy(asc(s.material_flashcard_entries.position))
        .all()
        .map((c) => ({ cardId: c.card_id, front: c.front, back: c.back }));

      return { ...base, kind: row.kind, content: { kind: row.kind, cards } };
    }
  }
}

export function readMaterial(store: ServerContext, id: bigint): MaterialDetailDto | null {
  const row = store.db.orm.select().from(s.materials).where(eq(s.materials.id, id)).get();

  if (!row) return null;

  const publishedRow = store.db.orm
    .select({ id: s.material_versions.id })
    .from(s.material_versions)
    .where(
      and(eq(s.material_versions.material_id, id), eq(s.material_versions.status, 'published'))
    )
    .orderBy(desc(s.material_versions.number))
    .get();
  const draftRow = store.db.orm
    .select({ id: s.material_versions.id })
    .from(s.material_versions)
    .where(and(eq(s.material_versions.material_id, id), eq(s.material_versions.status, 'draft')))
    .orderBy(desc(s.material_versions.number))
    .get();
  const published = publishedRow ? readVersion(store, publishedRow.id) : null;
  const draft = draftRow ? readVersion(store, draftRow.id) : null;

  return {
    ...row,
    version: required(published ?? draft),
    latestPublishedVersion: published && isPublished(published) ? published : null,
    latestDraftVersion: draft && isDraft(draft) ? draft : null
  };
}

function isPublished(
  version: MaterialVersionDetailDto
): version is MaterialVersionDetailDto & { status: 'published'; published_at: bigint } {
  return version.status === 'published' && version.published_at !== null;
}

function isDraft(
  version: MaterialVersionDetailDto
): version is MaterialVersionDetailDto & { status: 'draft'; published_at: null } {
  return version.status === 'draft' && version.published_at === null;
}

/** Bounded collection reads: payloads are loaded only by detail endpoints. */
export function readMaterialSummaries(store: ServerContext, ids: bigint[]): MaterialSummaryDto[] {
  if (!ids.length) return [];

  const rows = store.db.orm
    .select({
      material: s.materials,
      publishedId: sql<
        bigint | null
      >`(SELECT id FROM material_versions v WHERE v.material_id=${s.materials.id} AND v.status='published' ORDER BY v.number DESC LIMIT 1)`,
      draftId: sql<
        bigint | null
      >`(SELECT id FROM material_versions v WHERE v.material_id=${s.materials.id} AND v.status='draft' ORDER BY v.number DESC LIMIT 1)`
    })
    .from(s.materials)
    .where(inArray(s.materials.id, ids))
    .all();
  const versionIds = rows.flatMap((r) =>
    [r.publishedId, r.draftId].filter((id): id is bigint => id !== null)
  );
  const versions = versionIds.length
    ? store.db.orm
        .select()
        .from(s.material_versions)
        .where(inArray(s.material_versions.id, versionIds))
        .all()
    : [];
  const byVersion = new Map(versions.map((v) => [v.id, v]));
  const byMaterial = new Map(
    rows.map((r) => {
      const published = r.publishedId === null ? null : required(byVersion.get(r.publishedId));
      const draft = r.draftId === null ? null : required(byVersion.get(r.draftId));

      return [
        r.material.id,
        {
          ...r.material,
          version: required(published ?? draft),
          latestPublishedVersion: published,
          latestDraftVersion: draft
        }
      ] as const;
    })
  );

  return ids.map((id) => required(byMaterial.get(id)));
}
