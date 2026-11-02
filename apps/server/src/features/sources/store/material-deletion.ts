/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Cleans canonical source bytes and extraction content after Material publication is │
 * │ fenced.                                                                                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps exact deletion behavior behind the owning feature boundary.                      │
 * │ - Preserves durable identities without retaining private captured content.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns execution; public participants coordinate synchronous feature       │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import { materialIdSchema, sourceIdSchema } from '@study/contracts/ids';
import { eq, inArray, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
export const SourceMaterialDeletionStore = defineStore({
  name: 'study/SourceMaterialDeletionStore',
  entity: { singular: 'sourceMaterialDeletion', plural: 'sourceMaterialDeletions' },
  make: ({ db }) => ({
    queries: {},
    mutations: {
      prepare: storeMutation({
        input: materialIdSchema,
        output: Schema.Array(Schema.String),
        run: (id) => {
          const members = db.orm
            .select()
            .from(s.material_deletion_members)
            .where(eq(s.material_deletion_members.deletion_id, id))
            .all()
            .map((x) => x.material_id);
          const sources = db.orm
            .select()
            .from(s.material_imports)
            .where(inArray(s.material_imports.material_id, members))
            .all()
            .map((x) => x.source_id);
          const versions = db.orm
            .select()
            .from(s.material_versions)
            .where(inArray(s.material_versions.material_id, members))
            .all()
            .map((v) => v.id);
          const snapshots = db.orm
            .select()
            .from(s.material_source_snapshots)
            .where(inArray(s.material_source_snapshots.version_id, versions))
            .all();
          const docs = [
            ...db.orm
              .select()
              .from(s.material_document_versions)
              .where(inArray(s.material_document_versions.version_id, versions))
              .all()
              .map((d) => d.document_id),
            ...snapshots.flatMap((d) => (d.document_id === null ? [] : [d.document_id]))
          ];
          const assets = db.orm
            .select()
            .from(s.document_assets)
            .where(inArray(s.document_assets.document_id, docs))
            .all();
          for (const asset of [...assets, ...snapshots]) {
            const original = db.orm
              .select()
              .from(s.material_imports)
              .innerJoin(
                s.material_deletion_members,
                eq(s.material_imports.material_id, s.material_deletion_members.material_id)
              )
              .where(eq(s.material_imports.source_id, asset.source_id))
              .get();
            if (original)
              db.orm
                .insert(s.source_material_deletion_assets)
                .values({ deletion_id: id, source_id: asset.source_id, revision: asset.revision })
                .onConflictDoNothing()
                .run();
          }
          const events = db.orm
            .select()
            .from(s.workflowEvents)
            .where(
              inArray(
                sql<string>`json_extract(${s.workflowEvents.payload}, '$.sourceId')`,
                sources.map(String)
              )
            )
            .all()
            .filter((e) =>
              [
                'SourceProcessingRequested',
                'SourceCorrectionRequested',
                'SourceIndexed',
                'SourceProcessingFailed',
                'SourceProjectChanged'
              ].includes(e.type)
            );
          const ids = [...new Set(events.map((e) => e.correlationId))];
          return ids;
        }
      }),
      scrub: storeMutation({
        input: materialIdSchema,
        output: Schema.Void,
        run: (id) => {
          const members = db.orm
            .select()
            .from(s.material_deletion_members)
            .where(eq(s.material_deletion_members.deletion_id, id))
            .all()
            .map((x) => x.material_id);
          const sources = db.orm
            .select()
            .from(s.material_imports)
            .where(inArray(s.material_imports.material_id, members))
            .all()
            .map((x) => x.source_id);
          const assetSources = db.orm
            .select()
            .from(s.source_material_deletion_assets)
            .where(eq(s.source_material_deletion_assets.deletion_id, id))
            .all()
            .map((a) => a.source_id);
          for (const sourceId of new Set([...sources, ...assetSources])) {
            const retainedSource = db.orm
              .select()
              .from(s.material_source_snapshots)
              .where(eq(s.material_source_snapshots.source_id, sourceId))
              .get();
            if (!retainedSource)
              db.orm
                .delete(s.source_processing)
                .where(eq(s.source_processing.source_id, sourceId))
                .run();
            const documents = db.orm
              .select()
              .from(s.documents)
              .where(eq(s.documents.source_id, sourceId))
              .all();
            for (const doc of documents) {
              if (
                db.orm
                  .select()
                  .from(s.material_source_snapshots)
                  .where(eq(s.material_source_snapshots.document_id, doc.id))
                  .get() ||
                db.orm
                  .select()
                  .from(s.material_document_versions)
                  .where(eq(s.material_document_versions.document_id, doc.id))
                  .get()
              )
                continue;
              db.orm.delete(s.blocks).where(eq(s.blocks.document_id, doc.id)).run();
              db.orm.delete(s.documents).where(eq(s.documents.id, doc.id)).run();
            }
            // A retained source-version copy owns the bytes independently of the deleted original.
            if (
              db.orm
                .select()
                .from(s.material_source_snapshots)
                .where(eq(s.material_source_snapshots.source_id, sourceId))
                .get()
            )
              continue;
            db.orm
              .delete(s.source_processing)
              .where(eq(s.source_processing.source_id, sourceId))
              .run();
            db.orm.delete(s.source_blobs).where(eq(s.source_blobs.source_id, sourceId)).run();
            const assets = db.orm
              .select()
              .from(s.document_assets)
              .where(eq(s.document_assets.source_id, sourceId))
              .all();
            for (const revision of db.orm
              .select()
              .from(s.source_snapshots)
              .where(eq(s.source_snapshots.source_id, sourceId))
              .all()) {
              if (assets.some((a) => a.revision === revision.revision)) continue;
              db.orm
                .delete(s.source_snapshots)
                .where(
                  sql`${s.source_snapshots.source_id}=${sourceId} AND ${s.source_snapshots.revision}=${revision.revision}`
                )
                .run();
            }
            db.orm
              .update(s.sources)
              .set({ name: '-', uri: null, sha256: Buffer.alloc(32), size_bytes: 1n })
              .where(eq(s.sources.id, sourceId))
              .run();
          }
        }
      })
    }
  })
});

export const SourceMaterialImpactStore = defineStore({
  name: 'study/SourceMaterialImpactStore',
  entity: { singular: 'sourceMaterialImpact', plural: 'sourceMaterialImpacts' },
  make: ({ db }) => ({
    queries: {
      sourceMaterialImpact: storeQuery({
        role: 'required',
        input: Schema.Array(sourceIdSchema),
        output: Schema.String,
        run: (ids) => {
          const sources = db.orm
            .select()
            .from(s.sources)
            .where(inArray(s.sources.id, [...ids]))
            .all();
          const processing = db.orm
            .select()
            .from(s.source_processing)
            .where(inArray(s.source_processing.source_id, [...ids]))
            .all();
          const revisions = db.orm
            .select({
              sourceId: s.source_snapshots.source_id,
              revision: s.source_snapshots.revision
            })
            .from(s.source_snapshots)
            .where(inArray(s.source_snapshots.source_id, [...ids]))
            .all();
          return createHash('sha256')
            .update(
              JSON.stringify({ sources, processing, revisions }, (_, v) =>
                typeof v === 'bigint' ? String(v) : v
              )
            )
            .digest('hex');
        }
      })
    },
    mutations: {}
  })
});
