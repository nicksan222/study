import { z } from 'zod';

import { enqueueJob } from '#backend/procedures/jobs/worker';
import type { BackendContext } from '#backend/runtime/context';
import { invalid } from '#backend/runtime/errors';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { ProjectId } from '#backend/shared/ids';
import type { Source } from '#backend/shared/sources/types';

import { storeSource as dbStoreSource } from './upload-source.ts';

export const run = publicProcedure
  .input(
    z.object({
      project: idInput.nullish(),
      url: z.string()
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store, wake } = context;

    try {
      const url = new URL(r.url);

      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        invalid('Invalid link');
    } catch {
      invalid('Invalid link');
    }

    const source = store.transaction(() => {
      const value = addLink(store, r.project ?? null, r.url);

      enqueueJob(store, { kind: 'fetch', target: { type: 'source', id: value.id } });

      return value;
    });

    wake();

    return source;
  });

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
