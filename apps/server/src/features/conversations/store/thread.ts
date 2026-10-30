import { StudyError } from '@study/contracts/errors';
import type { PartId, SessionId } from '@study/contracts/ids';
import { eq } from '@study/db';
import { message_parts, messages } from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeThread({ db }: StoreResources) {
  function assertThreadRoot(sessionId: SessionId, threadRoot: PartId) {
    const root = db.orm
      .select({ sessionId: messages.session_id, threadRoot: messages.thread_root })
      .from(message_parts)
      .innerJoin(messages, eq(messages.id, message_parts.message_id))
      .where(eq(message_parts.id, threadRoot))
      .get();

    if (!root || root.sessionId !== sessionId || root.threadRoot !== null)
      throw new StudyError('invalid_input', 'invalid thread root');
  }

  return { assertThreadRoot };
}
