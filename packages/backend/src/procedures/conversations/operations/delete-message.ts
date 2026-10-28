import * as schema from '@study/db/schema';
import { eq } from 'drizzle-orm';

import type { BackendContext } from '#backend/runtime/context';
import type { MessageId } from '#backend/shared/ids';

export function deleteMessage(ctx: BackendContext, id: MessageId): boolean {
  return ctx.transaction(
    () => ctx.db.orm.delete(schema.messages).where(eq(schema.messages.id, id)).run().changes !== 0n
  );
}
