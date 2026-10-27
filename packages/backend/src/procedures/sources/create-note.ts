import { z } from 'zod';

import { enqueueJob } from '#backend/procedures/jobs/worker';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { ProjectId } from '#backend/shared/ids';
import type { Source } from '#backend/shared/sources/types';

import { storeSource as dbStoreSource } from './upload-source.ts';

export const run = publicProcedure
  .input(
    z.object({
      project: idInput.nullish(),
      title: z.string(),
      text: z.string().default('')
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store, wake } = context;

    const source = store.transaction(() => {
      const value = createNote(store, r.title, r.text, r.project ?? null);

      enqueueJob(store, { kind: 'extract', target: { type: 'source', id: value.id } });

      return value;
    });

    wake();

    return source;
  });

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
