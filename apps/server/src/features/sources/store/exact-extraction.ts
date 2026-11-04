/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads exact retained source extractions without following mutable processing       │
 * │ heads.                                                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reads exact retained source extractions without following mutable processing heads.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside its feature; callers own transaction scope. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
/** Sources resolves exact retained revisions without following a mutable extraction head. */
import * as c from '@study/contracts/sources/rpc';
import { and, asc, desc, eq, gt, lt, or, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema, Option } from 'effect';

import { decodeStoredBlock } from '#server/platform/database/content-block';
import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

function makeExtractions({ db }: StoreResources) {
  function extraction(v: typeof c.exactExtractionInputSchema.Type) {
    const row = db.orm
      .select({ snapshot: s.content_snapshots, name: s.sources.name })
      .from(s.source_extraction_revisions)
      .innerJoin(
        s.content_snapshots,
        eq(s.content_snapshots.id, s.source_extraction_revisions.snapshot_id)
      )
      .innerJoin(s.sources, eq(s.sources.id, s.source_extraction_revisions.source_id))
      .where(
        and(
          eq(s.source_extraction_revisions.source_id, v.sourceId),
          eq(s.source_extraction_revisions.revision, v.revision),
          eq(s.source_extraction_revisions.snapshot_id, v.snapshotId)
        )
      )
      .get();

    if (!row) throw new StudyError('not_found', 'Exact source extraction is unavailable');

    const blocks = db.orm
      .select()
      .from(s.blocks)
      .where(eq(s.blocks.document_id, v.snapshotId))
      .orderBy(asc(s.blocks.ordinal))
      .all()
      .map(decodeStoredBlock);

    return { ...v, name: row.name, document: { blocks, meta: JSON.parse(row.snapshot.meta) } };
  }

  return {
    extraction,
    currentExtraction: ({ id }: typeof c.currentExtractionInputSchema.Type) => {
      const state = db.orm
        .select()
        .from(s.source_processing)
        .where(eq(s.source_processing.source_id, id))
        .get();

      if (!state) throw new StudyError('not_found', 'Source is unavailable');

      if (state.request_id !== state.published_request_id || state.document_id === null)
        return null;

      return extraction({ sourceId: id, revision: state.revision, snapshotId: state.document_id });
    }
  };
}

export const SourceExtractionsStore = defineStore({
  name: 'study/SourceExtractionsStore',
  entity: { singular: 'extraction', plural: 'extractions' },
  make: (resources) => ({
    queries: {
      extractions: storeQuery({
        role: 'collection',
        input: c.extractionHistoryInputSchema,
        output: c.extractionPageSchema,
        run: ({ sourceId, limit, before }) => {
          const rows = resources.db.orm
            .select({
              sourceId: s.source_extraction_revisions.source_id,
              revision: s.source_extraction_revisions.revision,
              snapshotId: s.source_extraction_revisions.snapshot_id,
              createdAt: s.content_snapshots.created_at
            })
            .from(s.source_extraction_revisions)
            .innerJoin(
              s.content_snapshots,
              eq(s.content_snapshots.id, s.source_extraction_revisions.snapshot_id)
            )
            .where(
              and(
                eq(s.source_extraction_revisions.source_id, sourceId),
                before === undefined
                  ? undefined
                  : or(
                      lt(s.source_extraction_revisions.revision, before.revision),
                      and(
                        eq(s.source_extraction_revisions.revision, before.revision),
                        lt(s.source_extraction_revisions.snapshot_id, before.snapshotId)
                      )
                    )
              )
            )
            .orderBy(
              desc(s.source_extraction_revisions.revision),
              desc(s.source_extraction_revisions.snapshot_id)
            )
            .limit(limit + 1)
            .all();
          const items = rows.slice(0, limit);
          const last = items.at(-1);

          return {
            items,
            next:
              rows.length > limit && last
                ? { revision: last.revision, snapshotId: last.snapshotId }
                : null
          };
        }
      }),
      extraction: storeQuery({
        role: 'required',
        input: c.exactExtractionInputSchema,
        output: c.exactExtractionSchema,
        run: makeExtractions(resources).extraction
      })
    },
    mutations: {}
  })
});

export const CurrentExtractionStore = defineStore({
  name: 'study/CurrentExtractionStore',
  entity: { singular: 'currentExtraction', plural: 'currentExtractions' },
  make: (resources) => ({
    queries: {
      findCurrentExtraction: storeQuery({
        role: 'optional',
        input: c.currentExtractionInputSchema,
        output: Schema.Option(c.exactExtractionSchema),
        run: (v) => Option.fromNullishOr(makeExtractions(resources).currentExtraction(v))
      })
    },
    mutations: {}
  })
});

export const SessionSourcesStore = defineStore({
  name: 'study/SessionSourcesStore',
  entity: { singular: 'sessionSource', plural: 'sessionSources' },
  make: ({ db }) => {
    function assertSession(sessionId: typeof c.sessionSourcesInputSchema.Type.sessionId) {
      if (
        !db.orm.select().from(s.sessions).where(eq(s.sessions.id, sessionId)).get() ||
        db.orm
          .select()
          .from(s.session_deletions)
          .where(eq(s.session_deletions.session_id, sessionId))
          .get()
      )
        throw new StudyError('not_found', 'Session is unavailable');
    }

    return {
      queries: {
        sessionSources: storeQuery({
          role: 'collection',
          input: c.sessionSourcesInputSchema,
          output: Schema.Array(c.sessionSourceSchema),
          run: (v) => {
            assertSession(v.sessionId);

            return db.orm
              .select({
                id: s.sources.id,
                name: s.sources.name,
                kind: s.sources.kind,
                revision: s.source_processing.revision,
                snapshotId: s.source_processing.document_id,
                position: s.session_sources.position,
                requestId: s.source_processing.request_id,
                publishedRequestId: s.source_processing.published_request_id
              })
              .from(s.session_sources)
              .innerJoin(s.sources, eq(s.sources.id, s.session_sources.source_id))
              .innerJoin(s.source_processing, eq(s.source_processing.source_id, s.sources.id))
              .where(
                and(
                  eq(s.session_sources.session_id, v.sessionId),
                  sql`${s.session_sources.archived_at} IS NULL`,
                  v.afterPosition === undefined
                    ? undefined
                    : gt(s.session_sources.position, v.afterPosition)
                )
              )
              .orderBy(asc(s.session_sources.position))
              .limit(v.limit)
              .all()
              .map(({ publishedRequestId, requestId, ...row }) => ({
                ...row,
                snapshotId: publishedRequestId === requestId ? row.snapshotId : null,
                pending: requestId !== publishedRequestId
              }));
          }
        })
      },
      mutations: {
        attachSource: storeMutation({
          input: c.sourceLinkSchema,
          output: Schema.Void,
          run: (v) => {
            assertSession(v.sessionId);
            const last = db.orm
              .select()
              .from(s.session_sources)
              .where(eq(s.session_sources.session_id, v.sessionId))
              .orderBy(desc(s.session_sources.position))
              .get();

            db.orm
              .insert(s.session_sources)
              .values({
                session_id: v.sessionId,
                source_id: v.sourceId,
                position: (last?.position ?? -1n) + 1n
              })
              .onConflictDoNothing()
              .run();
          }
        }),
        detachSource: storeMutation({
          input: c.sourceLinkSchema,
          output: Schema.Void,
          run: (v) => {
            assertSession(v.sessionId);
            db.orm
              .delete(s.session_sources)
              .where(
                and(
                  eq(s.session_sources.session_id, v.sessionId),
                  eq(s.session_sources.source_id, v.sourceId)
                )
              )
              .run();
          }
        })
      }
    };
  }
});

export const SourceRevisionExportsStore = defineStore({
  name: 'study/SourceRevisionExportsStore',
  entity: { singular: 'revisionExport', plural: 'revisionExports' },
  make: ({ db }) => ({
    queries: {
      revisionExport: storeQuery({
        role: 'required',
        input: c.revisionExportInputSchema,
        output: c.revisionExportSchema,
        run: (v) => {
          const row = db.orm
            .select({
              // Older revisions predate filename retention. Never label old bytes with a replacement filename.
              name: sql<string>`CASE WHEN ${s.source_snapshots.revision}=(SELECT revision FROM source_processing WHERE source_id=${v.sourceId}) THEN ${s.sources.name} ELSE ${`source-${v.sourceId}-revision-${v.revision}`} END`,
              mime: s.source_snapshots.mime,
              bytes: s.source_snapshots.bytes
            })
            .from(s.source_snapshots)
            .innerJoin(s.sources, eq(s.sources.id, s.source_snapshots.source_id))
            .where(
              and(
                eq(s.source_snapshots.source_id, v.sourceId),
                eq(s.source_snapshots.revision, v.revision)
              )
            )
            .get();

          if (!row)
            throw new StudyError('not_found', 'Exact original source revision is unavailable');

          return { ...v, ...row, bytes: new Uint8Array(row.bytes) };
        }
      })
    },
    mutations: {}
  })
});
