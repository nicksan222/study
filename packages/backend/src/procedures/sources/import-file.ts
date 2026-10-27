import { openSync, closeSync } from 'node:fs';
import { basename } from 'node:path';

import { z } from 'zod';

import { enqueueJob } from '#backend/procedures/jobs/worker';
import type { BackendContext } from '#backend/runtime/context';
import { invalid } from '#backend/runtime/errors';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError, classifyError } from '#backend/shared/errors/index';
import type { ProjectId } from '#backend/shared/ids';
import { readImportFile } from '#backend/shared/sources/file';
import { sniff } from '#backend/shared/sources/sniff';
import type { Source } from '#backend/shared/sources/types';

import { storeSource as dbStoreSource } from './upload-source.ts';

export const run = publicProcedure
  .input(
    z.object({
      path: z.string(),
      project: idInput.nullish()
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const source = importFile(context.store, r.path, r.project ?? null);

    context.wake();

    return source;
  });

export function importSource(
  ctx: BackendContext,
  path: string,
  projectId: ProjectId | null = null
): Source {
  let bytes: Buffer;
  let fd: number | undefined;

  try {
    fd = openSync(path, 'r');
    bytes = readImportFile(fd);
  } catch (error) {
    if (error instanceof StudyError) throw error;

    const failure = classifyError(error);

    throw new StudyError(failure.kind, 'cannot import the file', {
      cause: error
    });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }

  const name = basename(path);
  const detected = sniff(name, bytes.subarray(0, 8192));

  return dbStoreSource(ctx, {
    name,
    bytes,
    ...detected,
    origin: 'import',
    projectId
  });
}

export function importFile(ctx: BackendContext, path: string, project: ProjectId | null): Source {
  if (!path || path.length > 32768) invalid('Invalid file path');

  return ctx.transaction(() => {
    const source = importSource(ctx, path, project);

    enqueueJob(ctx, {
      kind: source.kind === 'link' ? 'fetch' : 'extract',
      target: { type: 'source', id: source.id }
    });

    return source;
  });
}
