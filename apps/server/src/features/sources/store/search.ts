/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Projects source metadata and anchored passages from published extraction           │
 * │ snapshots.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Projects current published content into typed searchable entity records.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Owning feature visibility and membership rules remain outside the shared search          │
 * │ platform.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { searchProjectionPageInputSchema } from '@study/contracts/search/schemas';
import { anchorSchema } from '@study/contracts/sources/schemas';
import { and, asc, eq, inArray, sql } from '@study/db';
import { chunks, content_snapshots, source_processing, sources } from '@study/db/schema';
import { Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
import { searchProjectionPageQuery } from '#server/platform/search/projection-page';
import type { SearchProjection } from '#server/platform/search/types';

const decodeAnchor = Schema.decodeUnknownSync(Schema.fromJsonString(anchorSchema));

type ProjectionInput = typeof searchProjectionPageInputSchema.Type;

export function makeSourceSearchProjections({ db }: StoreResources) {
  const sourceEntries = (input: ProjectionInput): SearchProjection[] => {
    const entries: Array<SearchProjection> = [];
    const { offset, limit, targets } = input;
    const selected = targets?.filter((target) => target.type === 'source');
    const targetFilter =
      selected === undefined
        ? undefined
        : selected.length
          ? inArray(
              sources.id,
              selected.map((target) => target.sourceId)
            )
          : sql`0`;
    const rows = db.orm
      .select()
      .from(sources)
      .where(targetFilter)
      .orderBy(asc(sources.id))
      .limit(limit)
      .offset(offset)
      .all();

    for (const source of rows)
      entries.push({
        target: { type: 'source', sourceId: source.id },
        title: source.name,
        text: [source.name, source.kind, source.mime].join('\n'),
        projectIds: source.project_id === null ? [] : [source.project_id],
        revision: source.created_at.toString()
      });

    return entries;
  };
  const passageEntries = (input: ProjectionInput): SearchProjection[] => {
    const entries: Array<SearchProjection> = [];
    const { offset, limit, targets } = input;
    const selected = targets?.filter((target) => target.type === 'passage');
    const targetFilter =
      selected === undefined
        ? undefined
        : selected.length
          ? sql`(${chunks.id},${chunks.document_id},${sources.id}) IN (${sql.join(
              selected.map(
                (target) => sql`(${target.chunkId},${target.documentId},${target.sourceId})`
              ),
              sql`,`
            )})`
          : sql`0`;
    const rows = db.orm
      .select({ chunk: chunks, source: sources })
      .from(chunks)
      .innerJoin(content_snapshots, eq(content_snapshots.id, chunks.document_id))
      .innerJoin(sources, eq(sources.id, content_snapshots.source_id))
      .innerJoin(
        source_processing,
        and(
          eq(source_processing.document_id, content_snapshots.id),
          eq(source_processing.source_id, sources.id)
        )
      )
      .where(targetFilter)
      .orderBy(asc(chunks.id))
      .limit(limit)
      .offset(offset)
      .all();

    for (const { chunk, source } of rows)
      entries.push({
        target: {
          type: 'passage',
          chunkId: chunk.id,
          sourceId: source.id,
          documentId: chunk.document_id,
          anchor: decodeAnchor(chunk.anchor)
        },
        title: source.name,
        text: chunk.text,
        projectIds: source.project_id === null ? [] : [source.project_id],
        revision: chunk.document_id.toString()
      });

    return entries;
  };

  return (input: ProjectionInput = { offset: 0, limit: 1000 }): readonly SearchProjection[] => {
    const entries = [
      ...(input.kind === undefined || input.kind === 'source' ? sourceEntries(input) : []),
      ...(input.kind === undefined || input.kind === 'passage' ? passageEntries(input) : [])
    ];

    return entries;
  };
}

export const SourceSearchStore = defineStore({
  name: 'SourceSearch',
  entity: { singular: 'searchProjectionPage', plural: 'searchProjectionPages' },
  make: (resources) => ({
    queries: {
      searchProjectionPages: storeQuery(
        searchProjectionPageQuery(makeSourceSearchProjections(resources), true)
      )
    },
    mutations: {}
  })
});
