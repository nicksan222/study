/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Tracks exact historical Document and source-revision cleanup ownership.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reports independent version, Document asset and current source roots.                  │
 * │ - Removes obsolete Documents and only source bytes with no surviving owner.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Sources owns its content and proof rows; Materials supplies accepted version identities. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import {
  historyOperationKeySchema,
  historyVersionIdsSchema,
  historyPreviewSchema
} from '@study/contracts/materials/history';
import { eq, and, inArray } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { decodeEvent } from '#server/platform/workflows/events';

import { makeDocumentRetirement } from './document-retirement.ts';

export const SourceMaterialHistoryStore = defineStore({
  name: 'study/SourceMaterialHistoryStore',
  entity: { singular: 'sourceMaterialHistory', plural: 'sourceMaterialHistories' },
  make: (resources) => {
    const { db } = resources;
    const retirement = makeDocumentRetirement(resources);

    function roots(ids: typeof historyVersionIdsSchema.Type) {
      const pins = db.orm
        .select({
          source_id: s.material_source_snapshots.source_id,
          revision: s.material_source_snapshots.revision,
          document_id: s.material_source_snapshots.document_id
        })
        .from(s.material_source_snapshots)
        .where(inArray(s.material_source_snapshots.version_id, [...ids]))
        .all();

      const docs = [
        ...new Set([
          ...pins.flatMap((p) => (p.document_id === null ? [] : [p.document_id])),
          ...db.orm
            .select({ documentId: s.material_document_versions.document_id })
            .from(s.material_document_versions)
            .where(inArray(s.material_document_versions.version_id, [...ids]))
            .all()
            .map((d) => d.documentId)
        ])
      ];

      const assets = db.orm
        .select()
        .from(s.document_assets)
        .where(inArray(s.document_assets.document_id, docs))
        .all();

      const revisions = [
        ...new Map(
          [...pins, ...assets].map((p) => [
            `${p.source_id}/${p.revision}`,
            { sourceId: p.source_id, revision: p.revision }
          ])
        ).values()
      ];

      return { docs, revisions };
    }

    function requestIds(docs: readonly (typeof s.documents.$inferSelect.id)[]) {
      return [
        ...new Set(
          db.orm
            .select()
            .from(s.workflowEvents)
            .where(inArray(s.workflowEvents.type, ['SourceIndexed', 'SourceCorrectionRequested']))
            .all()
            .filter((row) => {
              if (row.payload === '{}') return false;

              const event = decodeEvent(row.payload);

              return (
                (event.type === 'SourceIndexed' || event.type === 'SourceCorrectionRequested') &&
                docs.includes(event.documentId)
              );
            })
            .map((e) => e.correlationId)
        )
      ];
    }

    function retained(
      sourceId: typeof s.sources.$inferSelect.id,
      revision: bigint,
      docs: readonly (typeof s.documents.$inferSelect.id)[],
      ids: typeof historyVersionIdsSchema.Type
    ) {
      return (
        db.orm
          .select()
          .from(s.material_source_snapshots)
          .where(
            and(
              eq(s.material_source_snapshots.source_id, sourceId),
              eq(s.material_source_snapshots.revision, revision)
            )
          )
          .all()
          .some((p) => !ids.includes(p.version_id)) ||
        db.orm
          .select()
          .from(s.document_assets)
          .where(
            and(eq(s.document_assets.source_id, sourceId), eq(s.document_assets.revision, revision))
          )
          .all()
          .some((a) => !docs.includes(a.document_id)) ||
        db.orm
          .select()
          .from(s.source_processing)
          .where(
            and(
              eq(s.source_processing.source_id, sourceId),
              eq(s.source_processing.revision, revision)
            )
          )
          .get() !== undefined
      );
    }

    function inspect(ids: typeof historyVersionIdsSchema.Type) {
      const { docs, revisions } = roots(ids);

      const sourceRevisions = revisions.map((r) => {
        const snapshot = db.orm
          .select()
          .from(s.source_snapshots)
          .where(
            and(
              eq(s.source_snapshots.source_id, r.sourceId),
              eq(s.source_snapshots.revision, r.revision)
            )
          )
          .get();

        const retainedVersionIds = db.orm
          .select()
          .from(s.material_source_snapshots)
          .where(
            and(
              eq(s.material_source_snapshots.source_id, r.sourceId),
              eq(s.material_source_snapshots.revision, r.revision)
            )
          )
          .all()
          .filter((p) => !ids.includes(p.version_id))
          .map((p) => p.version_id);

        const retainedDocumentIds = [
          ...new Set(
            db.orm
              .select()
              .from(s.document_assets)
              .where(
                and(
                  eq(s.document_assets.source_id, r.sourceId),
                  eq(s.document_assets.revision, r.revision)
                )
              )
              .all()
              .filter((a) => !docs.includes(a.document_id))
              .map((a) => a.document_id)
          )
        ];

        const currentSourceRevision =
          db.orm
            .select()
            .from(s.source_processing)
            .where(
              and(
                eq(s.source_processing.source_id, r.sourceId),
                eq(s.source_processing.revision, r.revision)
              )
            )
            .get() !== undefined;

        return {
          ...r,
          bytes: BigInt(snapshot?.bytes.length ?? 0),
          retained:
            retainedVersionIds.length > 0 ||
            retainedDocumentIds.length > 0 ||
            currentSourceRevision,
          retainedVersionIds,
          retainedDocumentIds,
          currentSourceRevision
        };
      });

      const docRows = db.orm.select().from(s.documents).where(inArray(s.documents.id, docs)).all();

      const processing = db.orm.select().from(s.source_processing).all();

      const requests = requestIds(docs);

      return {
        sourceRevisions,
        requestIds: requests,
        token: createHash('sha256')
          .update(
            JSON.stringify({ sourceRevisions, docRows, processing, requests }, (_, v) =>
              typeof v === 'bigint' ? String(v) : v
            )
          )
          .digest('hex')
      };
    }

    return {
      queries: {
        sourceMaterialHistory: storeQuery({
          role: 'required',
          input: historyVersionIdsSchema,
          output: Schema.Struct({
            token: Schema.String,
            sourceRevisions: historyPreviewSchema.fields.sourceRevisions,
            requestIds: Schema.Array(Schema.String)
          }),
          run: inspect
        })
      },
      mutations: {
        prepare: storeMutation({
          input: Schema.Struct({
            ...historyOperationKeySchema.fields,
            versionIds: historyVersionIdsSchema
          }),
          output: Schema.Void,
          run: ({ operationId, versionIds }) => {
            const { docs, revisions } = roots(versionIds);

            for (const documentId of docs)
              db.orm
                .insert(s.source_history_documents)
                .values({ operation_id: operationId, document_id: documentId })
                .run();

            for (const r of revisions)
              db.orm
                .insert(s.source_history_revisions)
                .values({ operation_id: operationId, source_id: r.sourceId, revision: r.revision })
                .run();
          }
        }),
        scrub: storeMutation({
          input: historyOperationKeySchema,
          output: Schema.Void,
          run: ({ operationId }) => {
            for (const r of db.orm
              .select()
              .from(s.source_history_documents)
              .where(eq(s.source_history_documents.operation_id, operationId))
              .all()) {
              if (
                retirement.hasVersionPin(r.document_id) ||
                db.orm
                  .select()
                  .from(s.source_processing)
                  .where(eq(s.source_processing.document_id, r.document_id))
                  .get()
              )
                continue;

              retirement.removeDocument(r.document_id);
            }

            for (const r of db.orm
              .select()
              .from(s.source_history_revisions)
              .where(eq(s.source_history_revisions.operation_id, operationId))
              .all()) {
              if (retained(r.source_id, r.revision, [], [])) continue;

              db.orm
                .delete(s.source_snapshots)
                .where(
                  and(
                    eq(s.source_snapshots.source_id, r.source_id),
                    eq(s.source_snapshots.revision, r.revision)
                  )
                )
                .run();
            }
          }
        })
      }
    };
  }
});
