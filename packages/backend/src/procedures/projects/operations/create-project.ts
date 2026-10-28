import * as schema from '@study/db/schema';

import type { BackendContext } from '#backend/runtime/context';
import type { Project } from '#backend/shared/projects/schemas';

import { nameOf, now } from './common.ts';

export function createProject(ctx: BackendContext, value: string): Project {
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
