import type { ServerContext } from '#server/runtime/context';
import type { ProjectId } from '#server/shared/ids';
import type { Source } from '#server/shared/sources/schemas';

import { storeSource as dbStoreSource } from './upload-source.ts';

export function createNote(
  ctx: ServerContext,
  name: string,
  text: string,
  projectId: ProjectId | null = null
): Source {
  return dbStoreSource(ctx, {
    name,
    bytes: Buffer.from(text),
    kind: 'note',
    mime: 'text/plain',
    origin: 'note',
    projectId
  });
}
