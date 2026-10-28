import type { BackendContext } from '#backend/runtime/context';
import type { ProjectId } from '#backend/shared/ids';
import type { Source } from '#backend/shared/sources/schemas';

import { storeSource as dbStoreSource } from './upload-source.ts';

export function createNote(
  ctx: BackendContext,
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
