import * as schema from '@study/db/schema';

import type { ServerContext } from '#server/runtime/context';
import type { Project } from '#server/shared/projects/schemas';

import { nameOf, now } from './common.ts';

export function createProject(ctx: ServerContext, value: string): Project {
  const name = nameOf(value),
    timestamp = now();
  const result = ctx.db.orm
    .insert(schema.projects)
    .values({ name, created_at: timestamp, updated_at: timestamp })
    .run();

  return {
    id: BigInt(result.lastInsertRowid),
    name,
    examOn: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}
