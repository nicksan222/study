import { StudyError } from '@study/contracts/errors';
import type { SessionId } from '@study/contracts/ids';
import { eq } from '@study/db';
import { sessions, messages, message_versions } from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

export function makePersistence({ db }: StoreResources) {
  function requiredSession(id: SessionId) {
    const row = db.orm.select().from(sessions).where(eq(sessions.id, id)).get();

    if (!row) throw new StudyError('not_found', 'session not found');

    return row;
  }

  function insertSelectedVersion(values: typeof message_versions.$inferInsert) {
    const version = db.orm.insert(message_versions).values(values).returning().get();

    db.orm
      .update(messages)
      .set({ active_version_id: version.id })
      .where(eq(messages.id, values.message_id))
      .run();

    return version;
  }

  return { requiredSession, insertSelectedVersion };
}
