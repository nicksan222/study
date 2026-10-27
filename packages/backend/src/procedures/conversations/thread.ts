import * as schema from '@study/db/schema';
import { eq, asc } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { ChatMessage } from '#backend/shared/conversations/messages';
import type { PartId } from '#backend/shared/ids';
import type { MessageId } from '#backend/shared/ids';

import { messageView, partView, message as opMessage } from './messages.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .query(({ ctx: context, input: r }) => {
    const { store } = context;
    const id = r.id;
    const found = thread(store, id);

    if (!found)
      return {
        value: null
      };

    const root = store.db.orm
      .select({ messageId: schema.message_parts.message_id })
      .from(schema.message_parts)
      .where(eq(schema.message_parts.id, id))
      .get();
    const owner = root ? opMessage(store, root.messageId) : null;

    if (!owner)
      return {
        value: null
      };

    return {
      value: {
        sessionId: owner.sessionId ?? null,
        messageId: owner.id ?? null,
        openedAt: owner.createdAt,
        root: partView(
          store,
          owner.parts.find((p) => p.id === id)!
        ),
        replies: found.messages.map((value) => messageView(store, value))
      }
    };
  });

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
