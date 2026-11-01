/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Provides shared transaction and persistence helpers for conversation records.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Centralizes transaction-backed writes for conversation persistence helpers.            │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the conversations service applies policy and    │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

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
