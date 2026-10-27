import { isDeepStrictEqual } from 'node:util';

import * as s from '@study/db/schema';
import { and, desc, eq, isNull, inArray } from 'drizzle-orm';

import { originalVersion } from '#backend/procedures/ingestion/source-material';
import { createMaterial } from '#backend/procedures/materials/create';
import { readCitations } from '#backend/procedures/materials/get-citations';
import { readMaterial, readVersion, required } from '#backend/procedures/materials/reads';
import { anchorSchema, createVersionSchema } from '#backend/procedures/materials/schemas';
import { materialTransaction } from '#backend/procedures/materials/transactions';
import { insertVersion, publish } from '#backend/procedures/materials/writes';
import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import type { MaterialContentInput, MaterialOperation } from '#backend/shared/materials/schemas';
import type { MaterialVersionDetail } from '#backend/shared/materials/types';
import type { Citation } from '#backend/shared/sources/citations';

import { artifact, cards, now } from './artifact.ts';

type CanonicalCitations = ReturnType<typeof readCitations>;

/** Runtime evidence can pin an exact snapshot before generation begins. */
export type CanonicalCitationInput = Citation & { inputVersionId?: bigint };

function usableInput(store: BackendContext, id: bigint, projectId: bigint) {
  return (
    store.db.orm
      .select({ id: s.material_versions.id })
      .from(s.material_versions)
      .innerJoin(s.materials, eq(s.materials.id, s.material_versions.material_id))
      .where(
        and(
          eq(s.material_versions.id, id),
          eq(s.material_versions.project_id, projectId),
          eq(s.material_versions.status, 'published'),
          isNull(s.materials.archived_at)
        )
      )
      .get() !== undefined
  );
}

/** Match the cited block, including its text, so a newer extraction cannot replace older evidence. */
export function canonicalEvidence(
  store: BackendContext,
  projectId: bigint,
  sourceIds: readonly (bigint | null)[],
  citations: readonly CanonicalCitationInput[]
) {
  const inputs = new Set<bigint>(),
    resolved: CanonicalCitations = [],
    citedSources = new Set<bigint>();

  for (const citation of citations) {
    if (citation.sourceId === null) continue;

    const source = store.db.orm
      .select()
      .from(s.sources)
      .where(eq(s.sources.id, citation.sourceId))
      .get();

    if (source?.project_id !== projectId) continue;

    const anchor = anchorSchema.safeParse(citation.anchor);

    if (!anchor.success || !citation.quote.trim()) continue;

    const documentSources = [citation.sourceId];

    if (source.kind === 'link') {
      const linkVersion = originalVersion(store, source.id);

      if (linkVersion) {
        const fetched = store.db.orm
          .select({ sourceId: s.material_file_versions.source_id })
          .from(s.material_file_versions)
          .innerJoin(
            s.material_version_inputs,
            eq(s.material_version_inputs.version_id, s.material_file_versions.version_id)
          )
          .innerJoin(
            s.material_versions,
            eq(s.material_versions.id, s.material_file_versions.version_id)
          )
          .where(
            and(
              eq(s.material_version_inputs.input_version_id, linkVersion.id),
              eq(s.material_versions.project_id, projectId),
              eq(s.material_versions.status, 'published')
            )
          )
          .all();

        documentSources.push(...fetched.map((row) => row.sourceId));
      }
    }

    const candidates = store.db.orm
      .select({ id: s.material_versions.id, anchor: s.blocks.anchor, text: s.blocks.text })
      .from(s.material_document_versions)
      .innerJoin(
        s.material_versions,
        eq(s.material_versions.id, s.material_document_versions.version_id)
      )
      .innerJoin(s.materials, eq(s.materials.id, s.material_versions.material_id))
      .innerJoin(s.documents, eq(s.documents.id, s.material_document_versions.document_id))
      .innerJoin(s.blocks, eq(s.blocks.document_id, s.documents.id))
      .where(
        and(
          inArray(s.documents.source_id, documentSources),
          eq(s.material_versions.project_id, projectId),
          eq(s.material_versions.status, 'published'),
          isNull(s.materials.archived_at)
        )
      )
      .orderBy(desc(s.material_versions.id))
      .all();
    const matched = candidates.find((row) => {
      if (citation.inputVersionId !== undefined && row.id !== citation.inputVersionId) return false;

      const candidateAnchor = anchorSchema.safeParse(JSON.parse(row.anchor));

      return (
        candidateAnchor.success &&
        isDeepStrictEqual(candidateAnchor.data, anchor.data) &&
        row.text.trim().includes(citation.quote.trim())
      );
    });
    const original = matched ? null : originalVersion(store, citation.sourceId);
    const versionId =
      matched?.id ??
      (citation.inputVersionId === undefined || citation.inputVersionId === original?.id
        ? original?.id
        : undefined);

    if (versionId === undefined || !usableInput(store, versionId, projectId)) continue;

    inputs.add(versionId);
    citedSources.add(citation.sourceId);
    resolved.push({
      marker: BigInt(citation.marker),
      inputVersionId: versionId,
      anchor: anchor.data,
      quote: citation.quote.trim()
    });
  }

  for (const sourceId of sourceIds) {
    if (sourceId === null) continue;

    if (citedSources.has(sourceId)) continue;

    const original = originalVersion(store, sourceId);

    if (original && usableInput(store, original.id, projectId)) inputs.add(original.id);
  }

  return { inputs: [...inputs], citations: resolved };
}

export function writeCanonicalVersion(
  store: BackendContext,
  input: {
    projectId: bigint;
    materialId?: bigint | null;
    title: string;
    content: MaterialContentInput;
    creator: 'agent' | 'user';
    operation: MaterialOperation;
    evidence?: ReturnType<typeof canonicalEvidence>;
    inherit?: MaterialVersionDetail;
  }
) {
  return materialTransaction(store, () => {
    const existing =
      input.materialId == null ? null : required(readMaterial(store, input.materialId));

    if (existing && existing.project_id !== input.projectId)
      throw new StudyError('invalid_input', 'Material belongs to another project');

    if (existing && existing.archived_at !== null)
      store.db.orm
        .update(s.materials)
        .set({ archived_at: null })
        .where(eq(s.materials.id, existing.id))
        .run();

    const parent = existing?.latestPublishedVersion;
    const evidence =
      input.evidence ??
      (input.inherit
        ? { inputs: input.inherit.inputs, citations: readCitations(store, input.inherit.id) }
        : { inputs: [], citations: [] });
    const versionInput = createVersionSchema.parse({
      content: input.content,
      operation: input.operation,
      inputs: evidence.inputs,
      parents: parent ? [parent.id] : [],
      publish: false
    });
    const id = existing
      ? insertVersion(store, existing.id, versionInput)
      : createMaterial(store, { ...versionInput, projectId: input.projectId, title: input.title })
          .version.id;

    store.db.orm
      .update(s.material_versions)
      .set({ creator: input.creator })
      .where(eq(s.material_versions.id, id))
      .run();

    for (const citation of evidence.citations)
      store.db.orm
        .insert(s.material_version_citations)
        .values({
          version_id: id,
          marker: citation.marker,
          input_version_id: citation.inputVersionId,
          anchor: JSON.stringify(citation.anchor),
          quote: citation.quote
        })
        .run();

    publish(store, id);

    return required(readVersion(store, id));
  });
}

/** Generation records are editable projections; every content edit advances the immutable graph. */
export function syncCanonicalArtifact(store: BackendContext, artifactId: bigint) {
  const projection = artifact(store, artifactId);

  if (!projection || projection.status !== 'complete') return;

  const previous =
    projection.materialId === null
      ? null
      : readMaterial(store, projection.materialId)?.latestPublishedVersion;
  const projectedCards = cards(store, artifactId);

  if (projection.kind === 'flashcards' && projectedCards.length === 0) {
    if (projection.materialId !== null)
      store.db.orm
        .update(s.materials)
        .set({ archived_at: now(), updated_at: now() })
        .where(eq(s.materials.id, projection.materialId))
        .run();

    return;
  }

  let content: MaterialContentInput;

  if (projection.kind === 'flashcards')
    content = {
      kind: 'flashcards',
      cards: projectedCards.map((card) => ({
        front: card.front,
        back: card.back,
        ...(card.materialCardId === undefined ? {} : { cardId: card.materialCardId })
      }))
    };
  else {
    if (projection.body?.type !== 'diagram') return;

    content = { kind: 'diagram', format: 'mermaid', payload: projection.body.mermaid };
  }

  const version = writeCanonicalVersion(store, {
    projectId: projection.projectId,
    materialId: projection.materialId,
    title: projection.title,
    content,
    creator: 'user',
    operation: 'edit',
    inherit: previous ?? undefined,
    ...(previous
      ? {}
      : {
          evidence: canonicalEvidence(
            store,
            projection.projectId,
            projection.sources,
            projection.citations
          )
        })
  });

  store.db.orm
    .update(s.artifacts)
    .set({ material_id: version.material_id })
    .where(eq(s.artifacts.id, artifactId))
    .run();

  if (version.kind === 'flashcards')
    version.content.cards.forEach((card, index) => {
      const row = projectedCards[index];

      if (row)
        store.db.orm
          .update(s.cards)
          .set({ material_card_id: card.cardId })
          .where(eq(s.cards.id, row.id))
          .run();
    });
}
