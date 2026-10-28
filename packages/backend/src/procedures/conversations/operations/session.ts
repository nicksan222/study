import * as schema from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { sessionRow } from '#backend/procedures/projects/operations/project-rows';
import type { BackendContext } from '#backend/runtime/context';
import type { ChatSession } from '#backend/shared/conversations/sessions';
import type { SessionId } from '#backend/shared/ids';

export function session(ctx: BackendContext, id: SessionId): ChatSession | null {
  const row = ctx.db.orm.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();

  return row ? sessionRow(row) : null;
}
