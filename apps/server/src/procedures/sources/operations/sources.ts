import * as schema from '@study/db/schema';
import { desc } from 'drizzle-orm';

import type { ServerContext } from '#server/runtime/context';
import type { Source } from '#server/shared/sources/schemas';

import { sourceRow, selectSources as dbSelectSources } from './source.ts';

export function listSources(ctx: ServerContext): Source[] {
  return dbSelectSources(ctx).orderBy(desc(schema.sources.id)).all().map(sourceRow);
}
