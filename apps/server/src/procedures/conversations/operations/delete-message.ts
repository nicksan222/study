import * as schema from '@study/db/schema';
import { eq } from 'drizzle-orm';

import type { ServerContext } from '#server/runtime/context';
import type { MessageId } from '#server/shared/ids';

export function deleteMessage(ctx: ServerContext, id: MessageId): boolean {
  return ctx.transaction(
    () => ctx.db.orm.delete(schema.messages).where(eq(schema.messages.id, id)).run().changes !== 0n
  );
}
