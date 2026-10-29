import * as schema from '@study/db/schema';
import { sql, desc, eq, and } from 'drizzle-orm';

import { sourceMaterial, originalVersion } from '#server/procedures/ingestion/source-material';
import { job as dbJob } from '#server/procedures/jobs/operations/job';
import { createMaterialFromDocument } from '#server/procedures/materials/operations/create-material';
import type { ServerContext } from '#server/runtime/context';
import type { JobId, SourceId, DocumentId } from '#server/shared/ids';
import type { Document } from '#server/shared/sources/document';
import type { DocumentMeta, BlockKind, Anchor } from '#server/shared/sources/document';

import { source as dbSource } from './source.ts';

export function now(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export function saveDocument(
  ctx: ServerContext,
  sourceId: SourceId,
  document: Document
): DocumentId {
  return ctx.transaction(() => insertDocument(ctx, sourceId, document));
}

export function saveRead(
  ctx: ServerContext,
  jobId: JobId,
  attempt: bigint,
  sourceId: SourceId,
  document: Document
): DocumentId | null {
  return ctx.transaction(() => {
    const job = dbJob(ctx, jobId);

    if (
      !job ||
      job.kind !== 'extract' ||
      job.status !== 'running' ||
      job.attempts !== attempt ||
      job.target.type !== 'source' ||
      job.target.id !== sourceId
    )
      return null;

    return insertDocument(ctx, sourceId, document);
  });
}

export function insertDocument(
  ctx: ServerContext,
  sourceId: SourceId,
  document: Document
): DocumentId {
  const result = ctx.db.orm
    .insert(schema.documents)
    .values({
      source_id: sourceId,
      extractor: document.meta.extractor as (typeof schema.documents.$inferInsert)['extractor'],
      extractor_version: BigInt(document.meta.extractorVersion),
      meta: JSON.stringify(document.meta),
      created_at: now()
    })
    .run();
  const id = result.lastInsertRowid as DocumentId;

  document.blocks.forEach((block, ordinal) =>
    ctx.db.orm
      .insert(schema.blocks)
      .values({
        document_id: id,
        ordinal: BigInt(ordinal),
        kind: block.kind,
        text: block.text,
        anchor: JSON.stringify(block.anchor)
      })
      .run()
  );

  const source = dbSource(ctx, sourceId);

  if (source?.projectId !== null && source) {
    const original = sourceMaterial(ctx, source)!;

    createMaterialFromDocument(ctx, {
      projectId: source.projectId,
      title: source.name.trim().slice(0, 200),
      documentId: id,
      inputs: [original.version.id],
      operation: source.kind === 'audio' || source.kind === 'video' ? 'transcribe' : 'extract'
    });
  }

  return id;
}

export function document(ctx: ServerContext, id: DocumentId): Document | null {
  const row = ctx.db.orm
    .select({
      meta: schema.documents.meta
    })
    .from(schema.documents)
    .where(sql`id = ${id}`)
    .get();

  if (!row) return null;

  const blocks = ctx.db.orm
    .select({
      kind: schema.blocks.kind,
      text: schema.blocks.text,
      anchor: schema.blocks.anchor
    })
    .from(schema.blocks)
    .where(sql`document_id = ${id}`)
    .orderBy(schema.blocks.ordinal)
    .all()
    .map((block) => ({
      kind: block.kind as BlockKind,
      text: block.text as string,
      anchor: JSON.parse(block.anchor as string) as Anchor
    }));

  return {
    meta: JSON.parse(row.meta as string) as DocumentMeta,
    blocks
  };
}

export function documentOf(
  ctx: ServerContext,
  sourceId: SourceId
): {
  id: DocumentId;
  document: Document;
} | null {
  let row = ctx.db.orm
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.source_id, sourceId))
    .orderBy(desc(schema.documents.id))
    .get();

  if (!row && dbSource(ctx, sourceId)?.kind === 'link') {
    const original = originalVersion(ctx, sourceId);

    if (original)
      row = ctx.db.orm
        .select({ id: schema.documents.id })
        .from(schema.material_version_inputs)
        .innerJoin(
          schema.material_file_versions,
          eq(schema.material_file_versions.version_id, schema.material_version_inputs.version_id)
        )
        .innerJoin(
          schema.material_versions,
          eq(schema.material_versions.id, schema.material_file_versions.version_id)
        )
        .innerJoin(schema.sources, eq(schema.sources.id, schema.material_file_versions.source_id))
        .innerJoin(schema.documents, eq(schema.documents.source_id, schema.sources.id))
        .where(
          and(
            eq(schema.material_version_inputs.input_version_id, original.id),
            eq(schema.material_versions.status, 'published'),
            eq(schema.sources.kind, 'web')
          )
        )
        .orderBy(desc(schema.material_file_versions.version_id), desc(schema.documents.id))
        .get();
  }

  if (!row) return null;

  const id = row.id as DocumentId;

  return {
    id,
    document: document(ctx, id)!
  };
}

export function sourceOfDocument(ctx: ServerContext, id: DocumentId): SourceId | null {
  return (
    (ctx.db.orm
      .select({
        source_id: schema.documents.source_id
      })
      .from(schema.documents)
      .where(sql`id = ${id}`)
      .get()?.source_id as SourceId | undefined) ?? null
  );
}
