import { createHash } from 'node:crypto';

import * as schema from '@study/db/schema';
import { sql, eq, getTableColumns } from 'drizzle-orm';
import { z } from 'zod';

import { originalVersion } from '#backend/procedures/ingestion/source-material';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { SourceId } from '#backend/shared/ids';
import { MAX_SOURCE_BYTES } from '#backend/shared/sources/sniff';
import type { SourceKind } from '#backend/shared/sources/sniff';
import type { Source } from '#backend/shared/sources/types';

import { storeSource } from './upload-source.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .query(({ ctx: context, input: r }) => {
    const { store } = context;
    const found = source(store, r.id);

    return {
      value: found ? found : null
    };
  });

export function sourceRow(row: ReturnType<ReturnType<typeof selectSources>['all']>[number]) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    mime: row.mime,
    origin: row.origin,
    projectId: row.project_id,
    projectName: row.project_name,
    sizeBytes: row.size_bytes,
    sha256: new Uint8Array(row.sha256),
    uri: row.uri,
    createdAt: row.created_at
  };
}

export function now(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export function selectSources(ctx: BackendContext) {
  return ctx.db.orm
    .select({
      ...getTableColumns(schema.sources),
      project_name: schema.projects.name
    })
    .from(schema.sources)
    .leftJoin(schema.projects, eq(schema.projects.id, schema.sources.project_id));
}

export function source(ctx: BackendContext, id: SourceId): Source | null {
  const row = selectSources(ctx).where(eq(schema.sources.id, id)).get();

  return row ? sourceRow(row) : null;
}

export function storeFetched(
  ctx: BackendContext,
  id: SourceId,
  input: {
    name: string;
    bytes: Uint8Array;
    kind: SourceKind;
    mime: string;
    uri: string | null;
  }
): Source | null {
  const name = input.name.trim();

  if (!name || !input.bytes.length || input.bytes.length > MAX_SOURCE_BYTES)
    throw new StudyError('invalid_input', 'invalid fetched source');

  return ctx.transaction(() => {
    const current = source(ctx, id);

    if (!current) return null;

    if (current.kind !== 'link') throw new StudyError('invalid_input', 'source is not a link');

    const original = originalVersion(ctx, id);

    if (!original) {
      const bytes = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);

      ctx.db.orm
        .update(schema.source_blobs)
        .set({ bytes })
        .where(sql`source_id = ${id}`)
        .run();
      ctx.db.orm
        .update(schema.sources)
        .set({
          name,
          kind: input.kind,
          mime: input.mime,
          size_bytes: BigInt(bytes.length),
          sha256: createHash('sha256').update(bytes).digest(),
          uri: input.uri
        })
        .where(sql`id = ${id}`)
        .run();

      return source(ctx, id);
    }

    const fetched = storeSource(
      ctx,
      {
        name,
        bytes: input.bytes,
        kind: input.kind,
        mime: input.mime,
        uri: input.uri,
        projectId: current.projectId,
        origin: 'web'
      },
      { inputs: original ? [original.id] : undefined }
    );

    return fetched;
  });
}

export function sourceBytes(ctx: BackendContext, id: SourceId): Uint8Array | null {
  const row = ctx.db.orm
    .select({
      bytes: schema.source_blobs.bytes
    })
    .from(schema.source_blobs)
    .where(sql`source_id = ${id}`)
    .get();

  return row ? new Uint8Array(row.bytes) : null;
}

export function readSourceBounded(
  ctx: BackendContext,
  id: SourceId,
  maxBytes: number
): Uint8Array | null {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new StudyError('invalid_input', 'invalid byte limit');

  const row = ctx.db.orm
    .select({
      bytes: sql`CASE WHEN length(bytes) <= ${maxBytes} THEN bytes ELSE NULL END`
    })
    .from(schema.source_blobs)
    .where(sql`source_id = ${id}`)
    .get();

  if (!row) throw new StudyError('not_found', 'source does not exist');

  return row.bytes === null ? null : new Uint8Array(row.bytes as Uint8Array);
}

export function readSourcePrefix(ctx: BackendContext, id: SourceId, maxBytes: number): Uint8Array {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new StudyError('invalid_input', 'invalid byte limit');

  const row = ctx.db.orm
    .select({
      bytes: sql`substr(bytes, 1, ${maxBytes})`
    })
    .from(schema.source_blobs)
    .where(sql`source_id = ${id}`)
    .get();

  if (!row) throw new StudyError('not_found', 'source does not exist');

  return new Uint8Array(row.bytes as Uint8Array);
}
