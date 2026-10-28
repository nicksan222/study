import { writeFileSync } from 'node:fs';

import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import type { SourceId } from '#backend/shared/ids';

import { sourceBytes as dbSourceBytes } from './source.ts';

export function exportSource(ctx: BackendContext, id: SourceId, path: string): void {
  const bytes = dbSourceBytes(ctx, id);

  if (!bytes) throw new StudyError('not_found', 'source does not exist');

  writeFileSync(path, bytes);
}
