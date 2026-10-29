import * as schema from '@study/db/schema';
import { eq } from 'drizzle-orm';

import {
  messageView,
  partView,
  message
} from '#server/procedures/conversations/operations/messages';
import { thread } from '#server/procedures/conversations/operations/thread';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    const found = thread(ctx.store, input.id);

    if (!found) return { value: null };

    const root = ctx.store.db.orm
      .select({ messageId: schema.message_parts.message_id })
      .from(schema.message_parts)
      .where(eq(schema.message_parts.id, input.id))
      .get();
    const owner = root ? message(ctx.store, root.messageId) : null;

    if (!owner) return { value: null };

    const part = owner.parts.find(({ id }) => id === input.id);

    if (!part) return { value: null };

    return {
      value: {
        sessionId: owner.sessionId,
        messageId: owner.id,
        openedAt: owner.createdAt,
        root: partView(ctx.store, part),
        replies: found.messages.map((reply) => messageView(ctx.store, reply))
      }
    };
  });
