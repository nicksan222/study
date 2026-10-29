import { writeFileSync } from 'node:fs';

import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { SourceId } from '#server/shared/ids';

import { sourceBytes as dbSourceBytes } from './source.ts';

export function exportSource(ctx: ServerContext, id: SourceId, path: string): void {
  const bytes = dbSourceBytes(ctx, id);

  if (!bytes) throw new StudyError('not_found', 'source does not exist');

  writeFileSync(path, bytes);
}
