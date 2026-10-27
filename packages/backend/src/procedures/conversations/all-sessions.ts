import * as schema from '@study/db/schema';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { sessionRow } from '#backend/procedures/projects/projects';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';
import type { ChatSession } from '#backend/shared/conversations/sessions';
import type { ProjectId } from '#backend/shared/ids';

export const run = publicProcedure.input(z.object({}).default({})).query(({ ctx: context }) => {
  const { store } = context;

  return {
    items: listAllSessions(store)
  };
});

export function listSessions(ctx: BackendContext, projectId: ProjectId): ChatSession[] {
  return ctx.db.orm
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.project_id, projectId))
    .orderBy(desc(schema.sessions.updated_at), desc(schema.sessions.id))
    .all()
    .map(sessionRow);
}

export function listAllSessions(ctx: BackendContext): ChatSession[] {
  return ctx.db.orm
    .select()
    .from(schema.sessions)
    .orderBy(desc(schema.sessions.updated_at), desc(schema.sessions.id))
    .all()
    .map(sessionRow);
}
