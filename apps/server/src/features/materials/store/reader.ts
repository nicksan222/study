/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads exact version-owned Documents, images and canonical import identities.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Resolves retained content through its explicit version and Document ownership.         │
 * │ - Applies deletion and history barriers before granting access to resources.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private read stores expose typed queries; services compose their operations.             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import * as input from '@study/contracts/materials/rpc';
import { materialSummarySchema } from '@study/contracts/materials/schemas';
import { and, eq, sql } from '@study/db';
import * as s from '@study/db/schema';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

import { makeReads, required } from './reads.ts';

export const MaterialVersionDocumentStore = defineStore({
  name: 'study/MaterialVersionDocumentStore',
  entity: { singular: 'materialVersionDocument', plural: 'materialVersionDocuments' },
  make: (resources) => {
    const reads = makeReads(resources);

    return {
      queries: {
        materialVersionDocument: storeQuery({
          role: 'required',
          input: input.materialVersionInputSchema,
          output: input.materialVersionDocumentSchema,
          run: ({ id }) => {
            reads.versionRow(id);
            const documentId = required(reads.versionDocumentId(id));
            return { id: documentId, document: reads.readCanonicalDocument(documentId) };
          }
        })
      },
      mutations: {}
    };
  }
});

export const ImportedMaterialStore = defineStore({
  name: 'study/ImportedMaterialStore',
  entity: { singular: 'importedMaterial', plural: 'importedMaterials' },
  make: (resources) => {
    const { db } = resources;
    const reads = makeReads(resources);

    return {
      queries: {
        importedMaterial: storeQuery({
          role: 'required',
          input: input.importedMaterialInputSchema,
          output: materialSummarySchema,
          run: ({ sourceId }) => {
            const binding = required(
              db.orm
                .select()
                .from(s.material_imports)
                .where(eq(s.material_imports.source_id, sourceId))
                .get()
            );
            reads.materialRow(binding.material_id);
            return required(reads.readMaterialSummaries([binding.material_id])[0]);
          }
        })
      },
      mutations: {}
    };
  }
});

export const MaterialVersionImageStore = defineStore({
  name: 'study/MaterialVersionImageStore',
  entity: { singular: 'materialVersionImage', plural: 'materialVersionImages' },
  make: (resources) => {
    const { db } = resources;
    const reads = makeReads(resources);

    return {
      queries: {
        materialVersionImage: storeQuery({
          role: 'required',
          input: input.materialVersionImageInputSchema,
          output: input.materialVersionImageSchema,
          run: (value) => {
            const version = reads.versionRow(value.id);
            if (reads.versionDocumentId(version.id) !== value.documentId)
              throw new StudyError('not_found', 'Version Document is unavailable');
            const block = reads
              .readCanonicalDocument(value.documentId)
              .blocks.find((item) => item.id === value.blockId);
            if (block?.content.type !== 'image')
              throw new StudyError('not_found', 'Version image block is unavailable');
            const image = block.content;
            // A draft cannot acquire read authority from a retired source revision.
            // An already published retained owner keeps its exact immutable asset.
            const row = db.orm
              .select({ snapshot: s.source_snapshots })
              .from(s.document_assets)
              .innerJoin(
                s.source_snapshots,
                and(
                  eq(s.source_snapshots.source_id, s.document_assets.source_id),
                  eq(s.source_snapshots.revision, s.document_assets.revision)
                )
              )
              .where(
                and(
                  eq(s.document_assets.document_id, value.documentId),
                  eq(s.document_assets.source_id, image.sourceId),
                  eq(s.document_assets.revision, BigInt(image.revision)),
                  version.status === 'published'
                    ? undefined
                    : sql`NOT EXISTS (
                  SELECT 1 FROM source_material_deletion_assets a
                  WHERE a.source_id=${image.sourceId} AND a.revision=${BigInt(image.revision)}
                ) AND NOT EXISTS (
                  SELECT 1 FROM source_history_revisions h
                  WHERE h.source_id=${image.sourceId} AND h.revision=${BigInt(image.revision)}
                )`
                )
              )
              .get()?.snapshot;
            if (!row || row.kind !== 'image' || !row.mime.toLowerCase().startsWith('image/'))
              throw new StudyError('not_found', 'Version image bytes are unavailable');
            return {
              sourceId: image.sourceId,
              revision: image.revision,
              mime: row.mime,
              bytes: new Uint8Array(row.bytes)
            };
          }
        })
      },
      mutations: {}
    };
  }
});
