import { openSync, closeSync } from 'node:fs';
import { basename } from 'node:path';

import { enqueueJob } from '#server/procedures/jobs/worker';
import type { ServerContext } from '#server/runtime/context';
import { invalid } from '#server/runtime/errors';
import { StudyError, classifyError } from '#server/shared/errors/index';
import type { ProjectId } from '#server/shared/ids';
import { readImportFile } from '#server/shared/sources/file';
import type { Source } from '#server/shared/sources/schemas';
import { sniff } from '#server/shared/sources/sniff';

import { storeSource as dbStoreSource } from './upload-source.ts';

export function importSource(
  ctx: ServerContext,
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

export function importFile(ctx: ServerContext, path: string, project: ProjectId | null): Source {
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
