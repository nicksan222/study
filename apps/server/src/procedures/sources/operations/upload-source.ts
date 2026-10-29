import { createHash } from 'node:crypto';

import * as schema from '@study/db/schema';

import { sourceMaterial } from '#server/procedures/ingestion/source-material';
import type { SourceMaterialOptions } from '#server/procedures/ingestion/source-material';
import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { SourceId } from '#server/shared/ids';
import type { Source } from '#server/shared/sources/schemas';
import { MAX_SOURCE_BYTES } from '#server/shared/sources/sniff';
import type { SourceKind, SourceOrigin } from '#server/shared/sources/sniff';

import { source as dbSource, now } from './source.ts';

type NewSource = Pick<Source, 'name' | 'mime'> & {
  kind: SourceKind;
  origin: SourceOrigin;
  projectId?: bigint | null;
  uri?: string | null;
  bytes: Uint8Array;
};

export function storeSource(
  ctx: ServerContext,
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
