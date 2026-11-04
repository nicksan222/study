import * as c from '@study/contracts/documents/schemas';
import type { DocumentCitation, ExactDocumentInput } from '@study/contracts/documents/types';
import type { StudyDocumentId, StudyDocumentVersionId } from '@study/contracts/ids';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { and, eq, inArray } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { validRange } from '#server/features/documents/decoders/range';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { invalid, required } from './errors.ts';
import type { makeDocumentReads } from './reads.ts';

export function makeDocumentEvidence(
  { db }: StoreResources,
  reads: ReturnType<typeof makeDocumentReads>
) {
  const orm = db.orm;
  const { version, content } = reads;
  function assertMessage(i: Extract<ExactDocumentInput, { kind: 'message' }>, inherited: boolean) {
    const row = orm
      .select()
      .from(s.message_versions)
      .where(eq(s.message_versions.id, i.versionId))
      .get();
    if (!row && inherited) return;
    if (required(row).status !== 'complete') invalid('Message input must be complete');
  }
  function assertSource(i: Extract<ExactDocumentInput, { kind: 'source' }>) {
    required(
      orm
        .select()
        .from(s.source_snapshots)
        .where(
          and(
            eq(s.source_snapshots.source_id, i.sourceId),
            eq(s.source_snapshots.revision, i.revision)
          )
        )
        .get()
    );
    if (i.snapshotId !== null) {
      const snap = required(
        orm.select().from(s.content_snapshots).where(eq(s.content_snapshots.id, i.snapshotId)).get()
      );
      if (snap.source_id !== i.sourceId) invalid('Input extraction belongs to another source');
      required(
        orm
          .select()
          .from(s.source_extraction_revisions)
          .where(
            and(
              eq(s.source_extraction_revisions.source_id, i.sourceId),
              eq(s.source_extraction_revisions.revision, i.revision),
              eq(s.source_extraction_revisions.snapshot_id, i.snapshotId)
            )
          )
          .get()
      );
    }
  }
  function assertInput(i: ExactDocumentInput, inherited = false) {
    switch (i.kind) {
      case 'document':
        if (version(i.versionId).status !== 'published')
          invalid('Document input must be published');
        return;
      case 'message':
        return assertMessage(i, inherited);
      case 'source':
        return assertSource(i);
    }
  }
  function assertCitations(citations: readonly DocumentCitation[]) {
    for (const citation of citations) {
      if (citation.target === null) continue;
      const input = citation.input;
      const body =
        input.kind === 'document'
          ? version(input.versionId).document
          : input.kind === 'source' && input.snapshotId !== null
            ? content(input.snapshotId)
            : null;
      if (!body || !validRange(body, citation.target, citation.quote))
        invalid('Citation target must match its exact input and quote');
    }
  }
  function insertEvidence(
    id: StudyDocumentVersionId,
    inputs: readonly ExactDocumentInput[],
    citations: readonly DocumentCitation[],
    allowUnavailableMessages = false
  ) {
    const equivalence = Schema.toEquivalence(c.exactInputSchema);
    if (inputs.some((x, i) => inputs.slice(0, i).some((y) => equivalence(x, y))))
      invalid('Duplicate exact inputs');
    const rows = inputs.map((i, position) => {
      assertInput(i, allowUnavailableMessages);
      return orm
        .insert(s.study_document_inputs)
        .values({
          version_id: id,
          position: BigInt(position),
          document_version_id: i.kind === 'document' ? i.versionId : null,
          source_id: i.kind === 'source' ? i.sourceId : null,
          source_revision: i.kind === 'source' ? i.revision : null,
          source_snapshot_id: i.kind === 'source' ? i.snapshotId : null,
          message_version_id:
            i.kind === 'message' &&
            orm
              .select()
              .from(s.message_versions)
              .where(eq(s.message_versions.id, i.versionId))
              .get()
              ? i.versionId
              : null,
          exact_message_version_id: i.kind === 'message' ? i.versionId : null
        })
        .returning()
        .get();
    });
    for (const x of citations) {
      const at = inputs.findIndex((i) => equivalence(i, x.input));
      if (at < 0) invalid('Citation must reference a declared exact input');
      if (x.target !== null) {
        if (x.target.start < 0 || x.target.end < x.target.start) invalid('Invalid citation target');
      }
      orm
        .insert(s.study_document_citations)
        .values({
          version_id: id,
          marker: BigInt(x.marker),
          input_id: required(rows[at]).id,
          anchor: JSON.stringify(x.anchor),
          target: x.target === null ? null : JSON.stringify(x.target),
          quote: x.quote
        })
        .run();
    }
  }
  function assertBlockOwnership(body: typeof documentSchema.Type, owner?: StudyDocumentId) {
    const ids = body.blocks.map((b) => b.id);
    if (!ids.length) return;
    const existing = orm
      .select({ documentId: s.study_document_versions.document_id })
      .from(s.blocks)
      .innerJoin(
        s.study_document_versions,
        eq(s.blocks.document_id, s.study_document_versions.content_snapshot_id)
      )
      .where(inArray(s.blocks.editing_id, ids))
      .all();
    if (existing.some((x) => owner === undefined || x.documentId !== owner))
      invalid('Editing identities belong to another document');
    if (
      owner === undefined &&
      orm.select().from(s.blocks).where(inArray(s.blocks.editing_id, ids)).get()
    )
      invalid('New authored blocks require fresh identities');
  }
  return { assertInput, assertCitations, insertEvidence, assertBlockOwnership };
}
