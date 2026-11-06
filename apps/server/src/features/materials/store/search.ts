/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Projects visible published learning materials without exposing hidden quiz answer  │
 * │ data.                                                                                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Projects current published content into typed searchable entity records.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Owning feature visibility and membership rules remain outside the shared search          │
 * │ platform.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type {
  MaterialId,
  MaterialVersionId,
  ProjectId,
  QuizQuestionId
} from '@study/contracts/ids';
import type {
  SearchTarget,
  searchProjectionPageInputSchema
} from '@study/contracts/search/schemas';
import { asc, inArray, sql } from '@study/db';
import {
  material_diagram_versions,
  material_flashcard_entries,
  material_quiz_choices,
  material_quiz_questions,
  project_materials
} from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
import { searchProjectionPageQuery } from '#server/platform/search/projection-page';
import type { SearchProjection } from '#server/platform/search/types';

type MaterialRow = {
  id: MaterialId;
  title: string;
  description: string | null;
  version_id: MaterialVersionId;
  kind: 'diagram' | 'quiz' | 'flashcards';
};

type ProjectionInput = typeof searchProjectionPageInputSchema.Type;

type QuestionRow = MaterialRow & { question_id: QuizQuestionId; prompt: string };

const visibleMaterial = sql`m.archived_at IS NULL AND v.status='published'
  AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published')
  AND NOT EXISTS(SELECT 1 FROM material_deletion_members d WHERE d.material_id=m.id)
  AND NOT EXISTS(SELECT 1 FROM material_history_members h WHERE h.version_id=v.id)`;

function append<K, V>(map: Map<K, V[]>, key: K, ...values: V[]) {
  const items = map.get(key) ?? [];

  items.push(...values);
  map.set(key, items);
}

function targetIdentity(target: SearchTarget) {
  if (target.type === 'material') return sql`(${target.materialId},${target.versionId})`;

  if (target.type === 'question')
    return sql`(${target.questionId},${target.materialId},${target.versionId})`;

  return undefined;
}

function targetFilter(input: ProjectionInput) {
  if (input.targets === undefined) return sql`1`;

  const identities = input.targets
    .filter((target) => target.type === input.kind)
    .flatMap((target) => {
      const identity = targetIdentity(target);

      return identity ? [identity] : [];
    });

  if (!identities.length) return sql`0`;

  const columns = input.kind === 'material' ? sql`(m.id,v.id)` : sql`(q.id,m.id,v.id)`;

  return sql`${columns} IN (${sql.join(identities, sql`,`)})`;
}

export function makeMaterialSearchProjections({ db }: StoreResources) {
  const membershipsFor = (rows: readonly MaterialRow[]) => {
    const memberships = new Map<MaterialId, ProjectId[]>();
    const ids = [...new Set(rows.map((row) => row.id))];

    for (const link of db.orm
      .select()
      .from(project_materials)
      .where(inArray(project_materials.material_id, ids))
      .orderBy(asc(project_materials.project_id))
      .all())
      append(memberships, link.material_id, link.project_id);

    return memberships;
  };
  const choicesFor = (ids: readonly QuizQuestionId[]) => {
    const choices = new Map<QuizQuestionId, string[]>();

    if (!ids.length) return choices;

    for (const choice of db.orm
      .select()
      .from(material_quiz_choices)
      .where(inArray(material_quiz_choices.question_id, ids))
      .orderBy(asc(material_quiz_choices.question_id), asc(material_quiz_choices.position))
      .all())
      append(choices, choice.question_id, choice.text);

    return choices;
  };
  const contentFor = (versions: readonly MaterialVersionId[]) => {
    const contents = new Map<MaterialVersionId, string[]>();

    for (const diagram of db.orm
      .select()
      .from(material_diagram_versions)
      .where(inArray(material_diagram_versions.version_id, versions))
      .all())
      append(contents, diagram.version_id, diagram.payload);

    for (const card of db.orm
      .select()
      .from(material_flashcard_entries)
      .where(inArray(material_flashcard_entries.version_id, versions))
      .orderBy(asc(material_flashcard_entries.version_id), asc(material_flashcard_entries.position))
      .all())
      append(contents, card.version_id, card.front, card.back);

    const questions = db.orm
      .select()
      .from(material_quiz_questions)
      .where(inArray(material_quiz_questions.version_id, versions))
      .orderBy(asc(material_quiz_questions.version_id), asc(material_quiz_questions.position))
      .all();
    const choices = choicesFor(questions.map((question) => question.id));

    for (const question of questions)
      append(contents, question.version_id, question.prompt, ...(choices.get(question.id) ?? []));

    return contents;
  };
  const materialsRows = (input: ProjectionInput) =>
    db.orm.all<MaterialRow>(sql`SELECT m.id,m.title,m.description,m.kind,v.id AS version_id
      FROM materials m JOIN material_versions v ON v.material_id=m.id
      WHERE ${visibleMaterial} AND ${targetFilter(input)} ORDER BY m.id LIMIT ${input.limit} OFFSET ${input.offset}`);
  const questionsRows = (input: ProjectionInput) =>
    db.orm
      .all<QuestionRow>(sql`SELECT m.id,m.title,m.description,m.kind,v.id AS version_id,q.id AS question_id,q.prompt
      FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id JOIN materials m ON m.id=v.material_id
      WHERE ${visibleMaterial} AND ${targetFilter(input)} ORDER BY q.id LIMIT ${input.limit} OFFSET ${input.offset}`);
  const materialsFor = (input: ProjectionInput): readonly SearchProjection[] => {
    const rows = materialsRows(input);

    if (!rows.length) return [];

    const memberships = membershipsFor(rows);
    const contents = contentFor(rows.map((row) => row.version_id));

    return rows.map((row) => ({
      target: { type: 'material', materialId: row.id, versionId: row.version_id },
      title: row.title,
      text: [row.title, row.description, ...(contents.get(row.version_id) ?? [])]
        .filter(Boolean)
        .join('\n'),
      projectIds: memberships.get(row.id) ?? [],
      revision: row.version_id.toString()
    }));
  };
  const questionsFor = (input: ProjectionInput): readonly SearchProjection[] => {
    const rows = questionsRows(input);

    if (!rows.length) return [];

    const memberships = membershipsFor(rows);
    const choices = choicesFor(rows.map((row) => row.question_id));

    return rows.map((row) => ({
      target: {
        type: 'question',
        questionId: row.question_id,
        materialId: row.id,
        versionId: row.version_id
      },
      title: row.prompt,
      text: [row.prompt, ...(choices.get(row.question_id) ?? [])].join('\n'),
      projectIds: memberships.get(row.id) ?? [],
      revision: row.version_id.toString()
    }));
  };

  return (input: ProjectionInput = { offset: 0, limit: 1000 }): readonly SearchProjection[] => {
    if (input.kind === undefined)
      return [
        ...questionsFor({ ...input, kind: 'question' }),
        ...materialsFor({ ...input, kind: 'material' })
      ];

    if (input.kind === 'material') return materialsFor(input);

    if (input.kind === 'question') return questionsFor(input);

    return [];
  };
}

export const MaterialSearchStore = defineStore({
  name: 'MaterialSearch',
  entity: { singular: 'searchProjectionPage', plural: 'searchProjectionPages' },
  make: (resources) => ({
    queries: {
      searchProjectionPages: storeQuery(
        searchProjectionPageQuery(makeMaterialSearchProjections(resources), true)
      )
    },
    mutations: {}
  })
});
