/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Projects current published authored documents using their canonical ordered block  │
 * │ text.                                                                                    │
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
  ContentSnapshotId,
  ProjectId,
  StudyDocumentId,
  StudyDocumentVersionId
} from '@study/contracts/ids';
import type { searchProjectionPageInputSchema } from '@study/contracts/search/schemas';
import { asc, inArray, sql } from '@study/db';
import { blocks, project_documents } from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
import { searchProjectionPageQuery } from '#server/platform/search/projection-page';
import type { SearchProjection } from '#server/platform/search/types';

type DocumentRow = {
  id: StudyDocumentId;
  title: string;
  description: string | null;
  version_id: StudyDocumentVersionId;
  content_snapshot_id: ContentSnapshotId;
};

export function makeDocumentSearchProjections({ db }: StoreResources) {
  return (
    input: typeof searchProjectionPageInputSchema.Type = { offset: 0, limit: 1000 }
  ): readonly SearchProjection[] => {
    if (input.kind !== undefined && input.kind !== 'document') return [];

    const selected = input.targets?.filter((target) => target.type === 'document');
    const filter =
      selected === undefined
        ? sql`1`
        : selected.length
          ? sql`(d.id,v.id) IN (${sql.join(
              selected.map((target) => sql`(${target.documentId},${target.versionId})`),
              sql`,`
            )})`
          : sql`0`;
    const rows = db.orm
      .all<DocumentRow>(sql`SELECT d.id,d.title,d.description,v.id AS version_id,v.content_snapshot_id
      FROM study_documents d JOIN study_document_versions v ON v.document_id=d.id
      AND v.status='published' AND v.number=(SELECT max(h.number) FROM study_document_versions h WHERE h.document_id=d.id AND h.status='published')
      WHERE d.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM study_document_deletions x WHERE x.document_id=d.id)
      AND NOT EXISTS(SELECT 1 FROM study_document_retirements x WHERE x.version_id=v.id) AND ${filter}
      ORDER BY d.id LIMIT ${input.limit} OFFSET ${input.offset}`);

    if (!rows.length) return [];

    const texts = new Map<ContentSnapshotId, string[]>();
    const memberships = new Map<StudyDocumentId, ProjectId[]>();

    for (const block of db.orm
      .select({ documentId: blocks.document_id, text: blocks.text })
      .from(blocks)
      .where(
        inArray(
          blocks.document_id,
          rows.map((row) => row.content_snapshot_id)
        )
      )
      .orderBy(asc(blocks.document_id), asc(blocks.ordinal))
      .all()) {
      const parts = texts.get(block.documentId) ?? [];

      parts.push(block.text);
      texts.set(block.documentId, parts);
    }

    for (const link of db.orm
      .select()
      .from(project_documents)
      .where(
        inArray(
          project_documents.document_id,
          rows.map((row) => row.id)
        )
      )
      .orderBy(asc(project_documents.project_id))
      .all()) {
      const ids = memberships.get(link.document_id) ?? [];

      ids.push(link.project_id);
      memberships.set(link.document_id, ids);
    }

    return rows.map((row) => ({
      target: { type: 'document', documentId: row.id, versionId: row.version_id },
      title: row.title,
      text: [row.title, row.description, ...(texts.get(row.content_snapshot_id) ?? [])]
        .filter(Boolean)
        .join('\n'),
      projectIds: memberships.get(row.id) ?? [],
      revision: row.version_id.toString()
    }));
  };
}

export const DocumentSearchStore = defineStore({
  name: 'DocumentSearch',
  entity: { singular: 'searchProjectionPage', plural: 'searchProjectionPages' },
  make: (resources) => ({
    queries: {
      searchProjectionPages: storeQuery(
        searchProjectionPageQuery(makeDocumentSearchProjections(resources))
      )
    },
    mutations: {}
  })
});
