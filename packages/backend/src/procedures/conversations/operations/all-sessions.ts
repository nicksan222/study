import * as schema from '@study/db/schema';
import { desc, eq } from 'drizzle-orm';

import { sessionRow } from '#backend/procedures/projects/operations/project-rows';
import type { BackendContext } from '#backend/runtime/context';
import type { ChatSession } from '#backend/shared/conversations/sessions';
import type { ProjectId } from '#backend/shared/ids';

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
