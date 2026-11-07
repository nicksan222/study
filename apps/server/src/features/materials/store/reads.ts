/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Groups read-side material store operations and their typed query definitions.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Collects read operations and schemas for the private material store.                   │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies                   │
 * │ policy and composes these private operations.                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { materialVersionIdSchema } from '@study/contracts/ids';
import type {
  MaterialId,
  MaterialVersionId,
  QuizChoiceId,
  QuizQuestionId
} from '@study/contracts/ids';
import { isTextQuestionKind } from '@study/contracts/materials/schemas';
import {
  materialCreatorSchema,
  materialKindSchema,
  materialSummarySchema
} from '@study/contracts/materials/schemas';
import type {
  MaterialDetailDto,
  MaterialSummaryDto,
  MaterialVersionDetailDto
} from '@study/contracts/materials/schemas';
import { eq, and, asc, desc, sql, inArray } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeExactInputs } from './exact-inputs.ts';

type QuizQuestionDetailDto = Extract<
  MaterialVersionDetailDto,
  { kind: 'quiz' }
>['content']['questions'][number];

export function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new StudyError('not_found', 'Material resource missing');

  return value;
}

export function makeReads(resources: StoreResources) {
  const store = resources.db;

  function assertAvailable(id: MaterialId) {
    if (
      store.orm
        .select()
        .from(s.material_deletion_members)
        .where(eq(s.material_deletion_members.material_id, id))
        .get()
    )
      throw new StudyError('not_found', 'Material is unavailable');
  }

  function materialRow(id: MaterialId, active = false) {
    assertAvailable(id);

    const row = required(store.orm.select().from(s.materials).where(eq(s.materials.id, id)).get());

    if (active && row.archived_at !== null)
      throw new StudyError('invalid_input', 'Material is archived');

    return row;
  }

  function assertVersionAvailable(id: MaterialVersionId) {
    if (
      store.orm
        .select()
        .from(s.material_history_members)
        .where(eq(s.material_history_members.version_id, id))
        .get()
    )
      throw new StudyError('not_found', 'Material version has been pruned');
  }

  function versionRow(id: MaterialVersionId, draft = false) {
    assertVersionAvailable(id);

    const row = required(
      store.orm.select().from(s.material_versions).where(eq(s.material_versions.id, id)).get()
    );

    assertAvailable(row.material_id);

    if (draft && row.status !== 'draft')
      throw new StudyError('invalid_input', 'Published versions are immutable');

    if (draft) materialRow(row.material_id, true);

    return row;
  }

  function readVersion(id: MaterialVersionId): MaterialVersionDetailDto | null {
    assertVersionAvailable(id);

    const row = store.orm
      .select()
      .from(s.material_versions)
      .where(eq(s.material_versions.id, id))
      .get();

    if (!row) return null;

    assertAvailable(row.material_id);

    return readVersionContent(row);
  }

  function readVersionBase(row: typeof s.material_versions.$inferSelect) {
    const id = row.id;

    return {
      ...row,
      creator: Schema.decodeUnknownSync(materialCreatorSchema)(row.creator),
      inputs: makeExactInputs(resources).inputs({ kind: 'version', id }),
      parents: store.orm
        .select()
        .from(s.material_version_parents)
        .where(eq(s.material_version_parents.version_id, id))
        .orderBy(asc(s.material_version_parents.parent_version_id))
        .all()
        .map((r) => r.parent_version_id)
    };
  }

  function readVersionContent(
    row: typeof s.material_versions.$inferSelect
  ): MaterialVersionDetailDto {
    const base = readVersionBase(row);

    switch (row.kind) {
      case 'diagram':
        return readDiagram(base);
      case 'quiz':
        return readQuiz(base);
      case 'flashcards':
        return readFlashcards(base);
      default:
        throw new StudyError('not_found', 'Learning artifact is unavailable');
    }
  }

  function readDiagram(
    base: ReturnType<typeof readVersionBase>
  ): Extract<MaterialVersionDetailDto, { kind: 'diagram' }> {
    const id = base.id;

    const c = required(
      store.orm
        .select()
        .from(s.material_diagram_versions)
        .where(eq(s.material_diagram_versions.version_id, id))
        .get()
    );

    return {
      ...base,
      kind: 'diagram',
      content: { kind: c.kind, format: c.format, payload: c.payload }
    };
  }

  /** Reconstruct complete version content, including matching keys for material review and export. */
  function readQuiz(
    base: ReturnType<typeof readVersionBase>
  ): Extract<MaterialVersionDetailDto, { kind: 'quiz' }> {
    const id = base.id;

    const choiceRows = store.orm
      .select({ choice: s.material_quiz_choices })
      .from(s.material_quiz_choices)
      .innerJoin(
        s.material_quiz_questions,
        eq(s.material_quiz_questions.id, s.material_quiz_choices.question_id)
      )
      .where(eq(s.material_quiz_questions.version_id, id))
      .orderBy(asc(s.material_quiz_choices.question_id), asc(s.material_quiz_choices.position))
      .all();

    const byQuestion = new Map<
      QuizQuestionId,
      { id: QuizChoiceId; text: string; isCorrect: boolean }[]
    >();

    for (const { choice: c } of choiceRows) {
      const group = byQuestion.get(c.question_id) ?? [];

      group.push({ id: c.id, text: c.text, isCorrect: c.is_correct });
      byQuestion.set(c.question_id, group);
    }

    const openRows = store.orm
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

    const questions: QuizQuestionDetailDto[] = store.orm
      .select()
      .from(s.material_quiz_questions)
      .where(eq(s.material_quiz_questions.version_id, id))
      .orderBy(asc(s.material_quiz_questions.position))
      .all()
      .map((q) => {
        const questionBase = { id: q.id, prompt: q.prompt, explanation: q.explanation };

        if (q.kind === 'matching')
          return { ...questionBase, kind: q.kind, pairs: required(q.matching_pairs) };

        if (isTextQuestionKind(q.kind))
          return {
            ...questionBase,
            kind: q.kind,
            referenceAnswer: required(references.get(q.id))
          };

        const choices = byQuestion.get(q.id) ?? [];

        if (q.kind === 'single_choice') return { ...questionBase, kind: q.kind, choices };

        return { ...questionBase, kind: q.kind, choices };
      });

    return { ...base, kind: 'quiz', content: { kind: 'quiz', questions } };
  }

  function readFlashcards(
    base: ReturnType<typeof readVersionBase>
  ): Extract<MaterialVersionDetailDto, { kind: 'flashcards' }> {
    const id = base.id;

    const cards = store.orm
      .select()
      .from(s.material_flashcard_entries)
      .where(eq(s.material_flashcard_entries.version_id, id))
      .orderBy(asc(s.material_flashcard_entries.position))
      .all()
      .map((c) => ({ cardId: c.card_id, front: c.front, back: c.back }));

    return { ...base, kind: 'flashcards', content: { kind: 'flashcards', cards } };
  }

  function latestVersion(id: MaterialId, status: typeof s.material_versions.$inferSelect.status) {
    return store.orm
      .select({ id: s.material_versions.id })
      .from(s.material_versions)
      .where(and(eq(s.material_versions.material_id, id), eq(s.material_versions.status, status)))
      .orderBy(desc(s.material_versions.number))
      .get();
  }

  function readMaterial(id: MaterialId): MaterialDetailDto | null {
    assertAvailable(id);

    const row = store.orm.select().from(s.materials).where(eq(s.materials.id, id)).get();

    if (!row) return null;

    const publishedRow = latestVersion(id, 'published');

    const draftRow = latestVersion(id, 'draft');

    const published = publishedRow ? readVersion(publishedRow.id) : null;

    const draft = draftRow ? readVersion(draftRow.id) : null;

    return {
      ...row,
      kind: Schema.decodeUnknownSync(materialKindSchema)(row.kind),
      projectIds: store.orm
        .select()
        .from(s.project_materials)
        .where(eq(s.project_materials.material_id, row.id))
        .all()
        .map((link) => link.project_id),
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

  function readMaterialSummaries(ids: MaterialId[]): MaterialSummaryDto[] {
    if (!ids.length) return [];

    const rows = store.orm
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

    const decodeVersionId = Schema.decodeUnknownSync(materialVersionIdSchema);

    const versionIds = rows.flatMap((r) =>
      [r.publishedId, r.draftId]
        .filter((id): id is bigint => id !== null)
        .map((id) => decodeVersionId(id))
    );

    const versions = versionIds.length
      ? store.orm
          .select()
          .from(s.material_versions)
          .where(inArray(s.material_versions.id, versionIds))
          .all()
      : [];

    const byVersion = new Map(versions.map((v) => [v.id, v]));

    const byMaterial = new Map(
      rows.map((r) => {
        const published =
          r.publishedId === null ? null : required(byVersion.get(decodeVersionId(r.publishedId)));

        const draft =
          r.draftId === null ? null : required(byVersion.get(decodeVersionId(r.draftId)));

        return [
          r.material.id,
          {
            ...r.material,
            kind: Schema.decodeUnknownSync(materialKindSchema)(r.material.kind),
            projectIds: store.orm
              .select()
              .from(s.project_materials)
              .where(eq(s.project_materials.material_id, r.material.id))
              .all()
              .map((link) => link.project_id),
            version: required(published ?? draft),
            latestPublishedVersion: published,
            latestDraftVersion: draft
          }
        ] as const;
      })
    );

    return ids.map((id) =>
      Schema.decodeUnknownSync(materialSummarySchema)(required(byMaterial.get(id)))
    );
  }

  return {
    materialRow,
    versionRow,
    readVersion,
    readMaterial,
    readMaterialSummaries
  };
}
