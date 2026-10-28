import * as schema from '@study/db/schema';
import { desc } from 'drizzle-orm';

import type { BackendContext } from '#backend/runtime/context';
import type { Source } from '#backend/shared/sources/schemas';

import { sourceRow, selectSources as dbSelectSources } from './source.ts';

export function listSources(ctx: BackendContext): Source[] {
  return dbSelectSources(ctx).orderBy(desc(schema.sources.id)).all().map(sourceRow);
}
