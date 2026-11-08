/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Projects current published authored pages using their canonical ordered block      │
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

import type { ContentSnapshotId, ProjectId, PageId, PageVersionId } from '@study/contracts/ids';
import type { SearchProjection, SearchProjectionPageInput } from '@study/contracts/search/schemas';
import { asc, inArray, sql } from '@study/db';
import { blocks, project_pages } from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
import { searchProjectionPageQuery } from '#server/platform/search/projection-page';

type PageRow = {
  id: PageId;
  title: string;
  description: string | null;
  version_id: PageVersionId;
  content_snapshot_id: ContentSnapshotId;
};

/** Read current published page versions with ordered blocks, project memberships, and retirement barriers. */
export function makePageSearchProjections({ db }: StoreResources) {
  return (
    input: SearchProjectionPageInput = { offset: 0, limit: 1000 }
  ): readonly SearchProjection[] => {
    if (input.kind !== undefined && input.kind !== 'page') return [];

    const selected = input.targets?.filter((target) => target.type === 'page');
    const filter =
      selected === undefined
        ? sql`1`
        : selected.length
          ? sql`(d.id,v.id) IN (${sql.join(
              selected.map((target) => sql`(${target.pageId},${target.versionId})`),
              sql`,`
            )})`
          : sql`0`;
    const rows = db.orm
      .all<PageRow>(sql`SELECT d.id,d.title,d.description,v.id AS version_id,v.content_snapshot_id
      FROM pages d JOIN page_versions v ON v.page_id=d.id
      AND v.status='published' AND v.number=(SELECT max(h.number) FROM page_versions h WHERE h.page_id=d.id AND h.status='published')
      WHERE d.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM page_deletions x WHERE x.page_id=d.id)
      AND NOT EXISTS(SELECT 1 FROM page_retirements x WHERE x.version_id=v.id) AND ${filter}
      ORDER BY d.id LIMIT ${input.limit} OFFSET ${input.offset}`);

    if (!rows.length) return [];

    const texts = new Map<ContentSnapshotId, string[]>();
    const memberships = new Map<PageId, ProjectId[]>();

    for (const block of db.orm
      .select({ snapshotId: blocks.document_id, text: blocks.text })
      .from(blocks)
      .where(
        inArray(
          blocks.document_id,
          rows.map((row) => row.content_snapshot_id)
        )
      )
      .orderBy(asc(blocks.document_id), asc(blocks.ordinal))
      .all()) {
      const parts = texts.get(block.snapshotId) ?? [];

      parts.push(block.text);
      texts.set(block.snapshotId, parts);
    }

    for (const link of db.orm
      .select()
      .from(project_pages)
      .where(
        inArray(
          project_pages.page_id,
          rows.map((row) => row.id)
        )
      )
      .orderBy(asc(project_pages.project_id))
      .all()) {
      const ids = memberships.get(link.page_id) ?? [];

      ids.push(link.project_id);
      memberships.set(link.page_id, ids);
    }

    return rows.map((row) => ({
      target: { type: 'page', pageId: row.id, versionId: row.version_id },
      title: row.title,
      text: [row.title, row.description, ...(texts.get(row.content_snapshot_id) ?? [])]
        .filter(Boolean)
        .join('\n'),
      projectIds: memberships.get(row.id) ?? [],
      revision: row.version_id.toString()
    }));
  };
}

export const PageSearchStore = defineStore({
  name: 'PageSearch',
  entity: { singular: 'searchProjectionPage', plural: 'searchProjectionPages' },
  make: (resources) => ({
    queries: {
      searchProjectionPages: storeQuery(
        searchProjectionPageQuery(makePageSearchProjections(resources))
      )
    },
    mutations: {}
  })
});
