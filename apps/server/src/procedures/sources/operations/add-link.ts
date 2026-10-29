import type { ServerContext } from '#server/runtime/context';
import type { ProjectId } from '#server/shared/ids';
import type { Source } from '#server/shared/sources/schemas';

import { storeSource as dbStoreSource } from './upload-source.ts';

export function addLink(ctx: ServerContext, projectId: ProjectId | null, value: string): Source {
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
