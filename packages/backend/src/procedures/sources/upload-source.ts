import { createHash } from 'node:crypto';

import * as schema from '@study/db/schema';
import { z } from 'zod';

import { sourceMaterial } from '#backend/procedures/ingestion/source-material';
import type { SourceMaterialOptions } from '#backend/procedures/ingestion/source-material';
import { enqueueJob } from '#backend/procedures/jobs/worker';
import type { BackendContext } from '#backend/runtime/context';
import { invalid } from '#backend/runtime/errors';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { SourceId } from '#backend/shared/ids';
import { sniff, MAX_SOURCE_BYTES } from '#backend/shared/sources/sniff';
import type { NewSource, Source } from '#backend/shared/sources/types';

import { source as dbSource, now } from './source.ts';

export const run = publicProcedure
  .input(
    z.object({
      name: z.string(),
      bytes: z.instanceof(Uint8Array),
      project: idInput.nullish()
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store, wake } = context;

    if (
      r.bytes.length > 16 * 1024 * 1024 ||
      !r.bytes.length ||
      !r.name.trim() ||
      r.name.length > 1024
    )
      invalid('Invalid upload');

    const source = store.transaction(() => {
      const value = storeSource(store, {
        name: r.name,
        bytes: r.bytes,
        ...sniff(r.name, r.bytes.subarray(0, 8192)),
        origin: 'import',
        projectId: r.project ?? null
      });

      enqueueJob(store, {
        kind: value.kind === 'link' ? 'fetch' : 'extract',
        target: { type: 'source', id: value.id }
      });

      return value;
    });

    wake();

    return source;
  });

export function storeSource(
  ctx: BackendContext,
  input: NewSource,
  options: SourceMaterialOptions = {}
): Source {
  const name = input.name.trim();

  if (!name) throw new StudyError('invalid_input', 'a source needs a name');

  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_SOURCE_BYTES)
    throw new StudyError('invalid_input', 'source size is outside the allowed range');

  const bytes = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
  const hash = createHash('sha256').update(bytes).digest();

  return ctx.transaction(() => {
    const result = ctx.db.orm
      .insert(schema.sources)
      .values({
        project_id: input.projectId ?? null,
        origin: input.origin,
        kind: input.kind,
        mime: input.mime,
        name: name,
        size_bytes: BigInt(bytes.length),
        sha256: hash,
        uri: input.uri ?? null,
        created_at: now()
      })
      .run();
    const id = result.lastInsertRowid as SourceId;

    ctx.db.orm
      .insert(schema.source_blobs)
      .values({
        source_id: id,
        bytes: bytes
      })
      .run();

    const source = dbSource(ctx, id)!;

    sourceMaterial(ctx, source, options);

    return source;
  });
}
