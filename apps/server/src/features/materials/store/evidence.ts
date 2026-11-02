/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Resolves retained evidence without substituting current content for history.       │
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

function unavailable(
  reference: typeof contract.evidenceReferenceSchema.Type,
  reason: Extract<
    typeof contract.evidenceResolutionSchema.Type,
    { availability: 'unavailable' }
  >['reason']
) {
  return {
    availability: 'unavailable' as const,
    precision: 'unavailable' as const,
    reference,
    reason
  };
}

function sourceChanged(
  snapshot: typeof s.material_source_snapshots.$inferSelect | undefined,
  processing: typeof s.source_processing.$inferSelect | undefined
) {
  return (
    snapshot !== undefined &&
    (snapshot.revision !== processing?.revision ||
      (snapshot.document_id !== null && snapshot.document_id !== processing?.document_id))
  );
}

export function makeEvidence(resources: StoreResources) {
  const { db } = resources;
  const reads = makeReads(resources);

  function sourceRevision(id: MaterialVersionId) {
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

    return {
      source: snapshot
        ? {
            sourceId: snapshot.source_id,
            inputRevision: Number(snapshot.revision),
            currentRevision: processing ? Number(processing.revision) : null,
            inputDocumentId: snapshot.document_id,
            currentDocumentId: processing?.document_id ?? null
          }
        : null,
      missing: snapshot !== undefined && !processing,
      changed: sourceChanged(snapshot, processing)
    };
  }

  function documentMissing(documentId: typeof s.documents.$inferSelect.id | null) {
    return (
      documentId !== null &&
      !db.orm
        .select({ id: s.documents.id })
        .from(s.documents)
        .where(eq(s.documents.id, documentId))
        .get()
    );
  }

  function currentVersion(version: typeof s.material_versions.$inferSelect | undefined) {
    return (
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
        .get()
    );
  }

  function revisionState(missing: boolean, changed: boolean) {
    return missing ? ('unavailable' as const) : changed ? ('stale' as const) : ('current' as const);
  }

  function revision(id: MaterialVersionId): typeof contract.evidenceRevisionSchema.Type {
    const version = db.orm
      .select()
      .from(s.material_versions)
      .where(eq(s.material_versions.id, id))
      .get();
    const deleted =
      version &&
      db.orm
        .select()
        .from(s.material_deletion_members)
        .where(eq(s.material_deletion_members.material_id, version.material_id))
        .get();
    if (deleted)
      return {
        inputVersionId: id,
        currentVersionId: null,
        inputDocumentId: null,
        currentDocumentId: null,
        source: null,
        state: 'unavailable' as const
      };
    const current = currentVersion(version);
    const inputDocumentId = version ? reads.versionDocumentId(id) : null;
    const currentDocumentId = current ? reads.versionDocumentId(current.id) : null;
    const source = sourceRevision(id);
    const missing = !version || !current || documentMissing(inputDocumentId) || source.missing;
    const changed = current?.id !== id || source.changed;

    return {
      inputVersionId: id,
      currentVersionId: current?.id ?? null,
      inputDocumentId,
      currentDocumentId,
      source: source.source,
      state: revisionState(missing, changed)
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

    if (
      !version ||
      version.status !== 'published' ||
      db.orm
        .select()
        .from(s.material_deletion_members)
        .where(eq(s.material_deletion_members.material_id, version.material_id))
        .get()
    )
      return unavailable(reference, 'version_missing');

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

    return resolveRange(reference, base);
  }

  function resolveRange(
    reference: Extract<typeof contract.evidenceReferenceSchema.Type, { kind: 'range' }>,
    base: Pick<
      Extract<typeof contract.evidenceResolutionSchema.Type, { availability: 'available' }>,
      'availability' | 'reference' | 'materialId' | 'origin' | 'revision'
    >
  ): typeof contract.evidenceResolutionSchema.Type {
    if (base.materialId !== reference.target.materialId)
      return unavailable(reference, 'material_mismatch');

    const range = reference.target.range;
    const documentId = reads.versionDocumentId(reference.target.range.versionId);

    if (documentId === null) return unavailable(reference, 'document_missing');

    if (documentId !== range.documentId) return unavailable(reference, 'document_mismatch');

    if (
      !db.orm
        .select({ id: s.documents.id })
        .from(s.documents)
        .where(eq(s.documents.id, documentId))
        .get()
    )
      return unavailable(reference, 'document_missing');

    const document = reads.readCanonicalDocument(documentId);
    const block = document.blocks.find((item) => item.id === range.blockId);

    if (!block) return unavailable(reference, 'block_missing');

    if (
      !validDocumentTextRange(
        document,
        { versionId: reference.target.range.versionId, documentId },
        range
      ) ||
      range.start === range.end
    )
      return unavailable(reference, 'range_invalid');

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
