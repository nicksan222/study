/** @file Read a bounded comparison history; source evidence and publication remain independently owned. */
import type { materialGenerationSnapshotSchema } from '@study/contracts';
import type { materialGenerationHistoryReferencesSchema } from '@study/contracts';
import { materialQuestionInputSchema } from '@study/contracts';
import type { materialGenerationHistorySchema as generationHistorySchema } from '@study/contracts';
import { and, asc, desc, eq, inArray, or, sql } from '@study/db';
import * as s from '@study/db';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { materialNoveltyItems } from '#server/features/materials/decoders/generation-novelty';

function historyIsLimited(
  versions: readonly { id: (typeof s.material_versions.$inferSelect)['id'] }[],
  snapshot?: typeof materialGenerationHistoryReferencesSchema.Type
) {
  if (!snapshot) return versions.length > 20;

  return (
    snapshot.limited ||
    snapshot.versions.some((id) => !versions.some((version) => version.id === id))
  );
}

export function makeGenerationHistory({ db }: StoreResources) {
  return (
    request: typeof materialGenerationSnapshotSchema.Type,
    snapshot?: typeof materialGenerationHistoryReferencesSchema.Type
  ): typeof generationHistorySchema.Type => {
    const evidence = s.material_evidence_inputs;
    const overlap = request.inputs.map((input) => {
      switch (input.kind) {
        case 'source':
          return eq(evidence.source_id, input.sourceId);
        case 'page':
          return eq(evidence.page_version_id, input.versionId);
        case 'note':
          return sql`EXISTS (
            SELECT 1 FROM ${s.note_run_contexts} AS retained
            JOIN ${s.note_run_contexts} AS selected ON selected.note_id = retained.note_id
            WHERE retained.request_id = ${evidence.note_context_id}
              AND selected.request_id = ${input.contextId}
          )`;
      }
    });
    const versions = db.orm
      .select({ id: s.material_versions.id })
      .from(s.material_versions)
      .innerJoin(
        s.project_materials,
        eq(s.project_materials.material_id, s.material_versions.material_id)
      )
      .where(
        and(
          eq(s.project_materials.project_id, request.projectId!),
          eq(s.material_versions.kind, request.kind),
          eq(s.material_versions.status, 'published'),
          snapshot
            ? inArray(s.material_versions.id, snapshot.versions)
            : sql`${s.material_versions.id} = (SELECT v.id FROM material_versions v WHERE v.material_id = ${s.material_versions.material_id} AND v.status = 'published' ORDER BY v.number DESC LIMIT 1)`,
          sql`NOT EXISTS (SELECT 1 FROM material_deletion_members d WHERE d.material_id = ${s.material_versions.material_id})`,
          sql`NOT EXISTS (SELECT 1 FROM material_history_members h WHERE h.version_id = ${s.material_versions.id})`,
          inArray(
            s.material_versions.id,
            db.orm
              .select({ id: s.material_evidence_inputs.version_id })
              .from(s.material_evidence_inputs)
              .where(or(...overlap))
          )
        )
      )
      .orderBy(desc(s.material_versions.published_at), desc(s.material_versions.id))
      .limit(21)
      .all();
    const items: (typeof generationHistorySchema.Type)['items'][number][] = [];
    let limited = historyIsLimited(versions, snapshot);
    let bytes = 0;
    const encoder = new TextEncoder();

    for (const version of versions.slice(0, 20)) {
      const entries =
        request.kind === 'flashcards'
          ? db.orm
              .select({
                prompt: sql<string>`substr(${s.material_flashcard_entries.front}, 1, 4001)`
              })
              .from(s.material_flashcard_entries)
              .where(eq(s.material_flashcard_entries.version_id, version.id))
              .orderBy(asc(s.material_flashcard_entries.position))
              .limit(101)
              .all()
              .map(({ prompt }) => ({
                prompt,
                key: materialNoveltyItems({
                  kind: 'flashcards',
                  cards: [{ front: prompt, back: '' }]
                })[0]!.key
              }))
          : db.orm
              .select({
                id: s.material_quiz_questions.id,
                kind: s.material_quiz_questions.kind,
                prompt: sql<string>`substr(${s.material_quiz_questions.prompt}, 1, 4001)`,
                pairs: sql<
                  string | null
                >`substr(${s.material_quiz_questions.matching_pairs}, 1, 8001)`
              })
              .from(s.material_quiz_questions)
              .where(eq(s.material_quiz_questions.version_id, version.id))
              .orderBy(asc(s.material_quiz_questions.position))
              .limit(101)
              .all()
              .map((question) => {
                if (question.pairs && question.pairs.length > 8000) {
                  limited = true;

                  return { prompt: '', key: '' };
                }

                const items =
                  question.kind === 'ordering'
                    ? db.orm
                        .select({
                          text: sql<string>`substr(${s.material_quiz_ordering_items.text}, 1, 2001)`
                        })
                        .from(s.material_quiz_ordering_items)
                        .where(eq(s.material_quiz_ordering_items.question_id, question.id))
                        .orderBy(asc(s.material_quiz_ordering_items.position))
                        .limit(10)
                        .all()
                    : [];

                if (items.some(({ text }) => text.length > 2000)) {
                  limited = true;

                  return { prompt: '', key: '' };
                }

                const value =
                  question.kind === 'ordering'
                    ? { ...question, items, explanation: 'History comparison' }
                    : question.kind === 'matching'
                      ? {
                          ...question,
                          pairs: JSON.parse(question.pairs!),
                          explanation: 'History comparison'
                        }
                      : {
                          kind: 'open',
                          prompt: question.prompt,
                          referenceAnswer: 'History comparison',
                          explanation: 'History comparison'
                        };

                return materialNoveltyItems({
                  kind: 'quiz',
                  questions: [Schema.decodeUnknownSync(materialQuestionInputSchema)(value)]
                })[0]!;
              });

      for (const item of entries) {
        const size = encoder.encode(JSON.stringify(item)).length + 100;

        if (
          !item.prompt ||
          item.prompt.length > 4000 ||
          items.length >= 100 ||
          bytes + size > 24000
        ) {
          limited = true;
          continue;
        }

        items.push({ ...item, versionId: version.id });
        bytes += size;
      }
    }

    return { items, limited };
  };
}
