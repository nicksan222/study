import type { BackendContext } from '#backend/runtime/context';
import type { ProjectId } from '#backend/shared/ids';
import type { Source } from '#backend/shared/sources/schemas';

import { storeSource as dbStoreSource } from './upload-source.ts';

export function addLink(ctx: BackendContext, projectId: ProjectId | null, value: string): Source {
  const uri = value.trim();

  return dbStoreSource(ctx, {
    name: uri,
    bytes: Buffer.from(uri),
    kind: 'link',
    mime: 'text/uri-list',
    origin: 'web',
    projectId,
    uri
  });
}
