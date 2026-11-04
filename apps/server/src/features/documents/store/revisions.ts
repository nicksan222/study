import * as c from '@study/contracts/documents/schemas';
import type { ExactDocumentInput, StudyDocumentVersion } from '@study/contracts/documents/types';
import type { StudyDocumentId, StudyDocumentVersionId } from '@study/contracts/ids';
import { encodeBlockContent } from '@study/contracts/sources/document';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { and, desc, eq } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { invalid } from './errors.ts';
import type { makeDocumentEvidence } from './provenance.ts';
import type { makeDocumentReads } from './reads.ts';

export function makeDocumentRevisions(
  { db, clock }: StoreResources,
  reads: ReturnType<typeof makeDocumentReads>,
  evidence: ReturnType<typeof makeDocumentEvidence>
) {
  const orm = db.orm;
  const now = () => unixSeconds(clock);
  const { aggregate, liveVersion } = reads;
  const { insertEvidence } = evidence;
  function insertVersion(
    documentId: StudyDocumentId,
    body: typeof documentSchema.Type,
    parents: readonly StudyDocumentVersionId[],
    inputs: readonly ExactDocumentInput[],
    citations: readonly (typeof c.citationSchema.Type)[],
    operation: StudyDocumentVersion['operation'] = 'original',
    creator: StudyDocumentVersion['creator'] = 'user',
    instruction: string | null = null,
    language: string | null = null
  ) {
    aggregate(documentId);
    Schema.decodeUnknownSync(c.authoredContentSchema)(body);
    for (const block of body.blocks) {
      if (block.content.type !== 'image') continue;
      const image = orm
        .select()
        .from(s.source_snapshots)
        .where(
          and(
            eq(s.source_snapshots.source_id, block.content.sourceId),
            eq(s.source_snapshots.revision, BigInt(block.content.revision))
          )
        )
        .get();
      if (!image || image.kind !== 'image' || !image.mime.toLowerCase().startsWith('image/'))
        invalid('Managed image revision is unavailable');
    }
    const time = now();
    const snapshot = orm
      .insert(s.content_snapshots)
      .values({
        extractor_version: BigInt(body.meta.extractorVersion),
        meta: JSON.stringify(body.meta),
        created_at: time
      })
      .returning()
      .get();
    body.blocks.forEach((b, i) => {
      orm
        .insert(s.blocks)
        .values({
          document_id: snapshot.id,
          ordinal: BigInt(i),
          kind: b.kind,
          editing_id: b.id,
          content: encodeBlockContent(b.content),
          text: b.text,
          anchor: JSON.stringify(b.anchor)
        })
        .run();
    });
    const last = orm
      .select()
      .from(s.study_document_versions)
      .where(eq(s.study_document_versions.document_id, documentId))
      .orderBy(desc(s.study_document_versions.number))
      .get();
    const row = orm
      .insert(s.study_document_versions)
      .values({
        document_id: documentId,
        number: (last?.number ?? 0n) + 1n,
        content_snapshot_id: snapshot.id,
        operation,
        creator,
        instruction,
        language,
        created_at: time
      })
      .returning()
      .get();
    for (const id of new Set(parents))
      orm
        .insert(s.study_document_version_parents)
        .values({ version_id: row.id, parent_version_id: id, document_id: documentId })
        .run();
    insertEvidence(row.id, inputs, citations, true);
    return row;
  }
  function publish(id: StudyDocumentVersionId) {
    const v = liveVersion(id);
    orm
      .update(s.study_document_versions)
      .set({ status: 'published', published_at: now() })
      .where(eq(s.study_document_versions.id, id))
      .run();
    orm
      .update(s.study_documents)
      .set({ updated_at: now() })
      .where(eq(s.study_documents.id, v.document_id))
      .run();
  }
  return { insertVersion, publish };
}
