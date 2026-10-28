import * as schema from '@study/db/schema';
import { eq, asc } from 'drizzle-orm';

import type { BackendContext } from '#backend/runtime/context';
import type { ChatMessage } from '#backend/shared/conversations/messages';
import type { PartId } from '#backend/shared/ids';
import type { MessageId } from '#backend/shared/ids';

import { message as opMessage } from './messages.ts';

export function thread(
  ctx: BackendContext,
  root: PartId
): {
  root: PartId;
  messages: ChatMessage[];
} | null {
  const part = ctx.db.orm
    .select({
      id: schema.message_parts.id
    })
    .from(schema.message_parts)
    .where(eq(schema.message_parts.id, root))
    .get();

  if (!part) return null;

  return {
    root,
    messages: ctx.db.orm
      .select({
        id: schema.messages.id
      })
      .from(schema.messages)
      .where(eq(schema.messages.thread_root, root))
      .orderBy(asc(schema.messages.id))
      .all()
      .map((r) => opMessage(ctx, r.id as MessageId)!)
  };
}
