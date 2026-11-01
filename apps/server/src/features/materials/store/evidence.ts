/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Resolves retained evidence without substituting current content for historic targets. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Separates exact editor targets from original locations and current revision state.     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Materials reads canonical retained Documents and never rewrites dependent content.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { MaterialVersionId } from '@study/contracts/ids';
import * as contract from '@study/contracts/materials/evidence';
import { dependentsInputSchema } from '@study/contracts/materials/rpc';
import { validDocumentTextRange } from '@study/contracts/sources/document';
import { and, asc, desc, eq, gt } from '@study/db';
import * as s from '@study/db/schema';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeReads } from './reads.ts';

export function makeEvidence(resources: StoreResources) {
  const { db } = resources;
  const reads = makeReads(resources);

  function revision(id: MaterialVersionId): typeof contract.evidenceRevisionSchema.Type {
    const version = db.orm
      .select()
      .from(s.material_versions)
      .where(eq(s.material_versions.id, id))
      .get();
    const current =
      version &&
      db.orm
        .select()
        .from(s.material_versions)
        .where(
          and(
            eq(s.material_versions.material_id, version.material_id),
            eq(s.material_versions.status, 'published')
          )
        )
        .orderBy(desc(s.material_versions.number))
        .get();
    const snapshot = db.orm
      .select()
      .from(s.material_source_snapshots)
      .where(eq(s.material_source_snapshots.version_id, id))
      .get();
    const processing =
      snapshot &&
      db.orm
        .select()
        .from(s.source_processing)
        .where(eq(s.source_processing.source_id, snapshot.source_id))
        .get();
    const inputDocumentId = version ? reads.versionDocumentId(id) : null;
    const currentDocumentId = current ? reads.versionDocumentId(current.id) : null;
    const documentMissing =
      inputDocumentId !== null &&
      !db.orm
        .select({ id: s.documents.id })
        .from(s.documents)
        .where(eq(s.documents.id, inputDocumentId))
        .get();
    const missing =
      !version || !current || documentMissing || (snapshot !== undefined && !processing);
    const changed =
      current?.id !== id ||
      (snapshot !== undefined &&
        (snapshot.revision !== processing?.revision ||
          (snapshot.document_id !== null && snapshot.document_id !== processing?.document_id)));

    return {
      inputVersionId: id,
      currentVersionId: current?.id ?? null,
      inputDocumentId,
      currentDocumentId,
      source: snapshot
        ? {
            sourceId: snapshot.source_id,
            inputRevision: Number(snapshot.revision),
            currentRevision: processing ? Number(processing.revision) : null,
            inputDocumentId: snapshot.document_id,
            currentDocumentId: processing?.document_id ?? null
          }
        : null,
      state: missing ? 'unavailable' : changed ? 'stale' : 'current'
    };
  }

  function resolve(
    reference: typeof contract.evidenceReferenceSchema.Type
  ): typeof contract.evidenceResolutionSchema.Type {
    const id = reference.kind === 'range' ? reference.target.range.versionId : reference.versionId;
    const version = db.orm
      .select()
      .from(s.material_versions)
      .where(eq(s.material_versions.id, id))
      .get();
    const unavailable = (
      reason: Extract<
        typeof contract.evidenceResolutionSchema.Type,
        { availability: 'unavailable' }
      >['reason']
    ) => ({
      availability: 'unavailable' as const,
      precision: 'unavailable' as const,
      reference,
      reason
    });

    if (!version || version.status !== 'published') return unavailable('version_missing');

    const base = {
      availability: 'available' as const,
      reference,
      materialId: version.material_id,
      origin: version.creator,
      revision: revision(id)
    };

    if (reference.kind === 'anchor')
      return {
        ...base,
        precision: 'approximate',
        location: reference.anchor,
        locationPrecision: reference.anchor.type === 'authored' ? 'unavailable' : 'approximate',
        block: null,
        excerpt: null
      };

    if (version.material_id !== reference.target.materialId)
      return unavailable('material_mismatch');

    const range = reference.target.range;
    const documentId = reads.versionDocumentId(id);

    if (documentId === null) return unavailable('document_missing');
    if (documentId !== range.documentId) return unavailable('document_mismatch');
    if (
      !db.orm
        .select({ id: s.documents.id })
        .from(s.documents)
        .where(eq(s.documents.id, documentId))
        .get()
    )
      return unavailable('document_missing');

    const document = reads.readCanonicalDocument(documentId);
    const block = document.blocks.find((item) => item.id === range.blockId);

    if (!block) return unavailable('block_missing');
    if (
      !validDocumentTextRange(document, { versionId: id, documentId }, range) ||
      range.start === range.end
    )
      return unavailable('range_invalid');

    return {
      ...base,
      precision: 'exact',
      location: block.anchor,
      locationPrecision: block.anchor.type === 'authored' ? 'unavailable' : 'approximate',
      block,
      excerpt: block.text.slice(range.start, range.end)
    };
  }

  function dependents(value: typeof dependentsInputSchema.Type) {
    const rows = db.orm
      .select()
      .from(s.material_version_inputs)
      .where(
        and(
          eq(s.material_version_inputs.input_version_id, value.id),
          value.cursor === undefined
            ? undefined
            : gt(s.material_version_inputs.version_id, value.cursor)
        )
      )
      .orderBy(asc(s.material_version_inputs.version_id))
      .limit(value.limit + 1)
      .all();
    const page = rows.slice(0, value.limit);

    return {
      items: page.map((row) => ({
        dependentVersionId: row.version_id,
        ...revision(row.input_version_id)
      })),
      nextCursor: rows.length > value.limit ? page.at(-1)!.version_id : null
    };
  }

  return { resolve, revision, dependents };
}

export const EvidenceStore = defineStore({
  name: 'study/EvidenceStore',
  entity: { singular: 'evidence', plural: 'evidences' },
  make: (resources) => {
    const evidence = makeEvidence(resources);

    return {
      queries: {
        evidence: storeQuery({
          role: 'required',
          input: contract.evidenceReferenceSchema,
          output: contract.evidenceResolutionSchema,
          run: evidence.resolve
        })
      },
      mutations: {}
    };
  }
});

export const DependencyStatusStore = defineStore({
  name: 'study/DependencyStatusStore',
  entity: { singular: 'dependencyStatus', plural: 'dependencyStatuses' },
  make: (resources) => {
    const evidence = makeEvidence(resources);

    return {
      queries: {
        dependencyStatuses: storeQuery({
          role: 'collection',
          input: dependentsInputSchema,
          output: contract.dependencyPageSchema,
          run: evidence.dependents
        })
      },
      mutations: {}
    };
  }
});
