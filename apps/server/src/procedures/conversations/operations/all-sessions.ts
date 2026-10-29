import { desc, eq } from '@study/db';
import * as schema from '@study/db/schema';

import { sessionRow } from '#server/procedures/projects/operations/project-rows';
import type { ServerContext } from '#server/runtime/context';
import type { ChatSession } from '#server/shared/conversations/sessions';
import type { ProjectId } from '#server/shared/ids';

export function listSessions(ctx: ServerContext, projectId: ProjectId): ChatSession[] {
  return ctx.db.orm
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.project_id, projectId))
    .orderBy(desc(schema.sessions.updated_at), desc(schema.sessions.id))
    .all()
    .map(sessionRow);
}

export function listAllSessions(ctx: ServerContext): ChatSession[] {
  return ctx.db.orm
    .select()
    .from(schema.sessions)
    .orderBy(desc(schema.sessions.updated_at), desc(schema.sessions.id))
    .all()
    .map(sessionRow);
}
