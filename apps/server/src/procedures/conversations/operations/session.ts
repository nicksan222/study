import * as schema from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { sessionRow } from '#server/procedures/projects/operations/project-rows';
import type { ServerContext } from '#server/runtime/context';
import type { ChatSession } from '#server/shared/conversations/sessions';
import type { SessionId } from '#server/shared/ids';

export function session(ctx: ServerContext, id: SessionId): ChatSession | null {
  const row = ctx.db.orm.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();

  return row ? sessionRow(row) : null;
}
