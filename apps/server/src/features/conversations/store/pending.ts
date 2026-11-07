/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Discards unfinished reply versions while preserving completed message history.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Restores the previous completed selection when abandoning a reply or rewrite.          │
 * │ - Removes empty reply shells and their private instructions.                             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Conversation stores invoke this helper inside their owning synchronous transaction.      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { and, desc, eq } from '@study/db';
import { messages, message_versions } from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeDiscardPending({ db }: StoreResources) {
  function discardPending(
    message: typeof messages.$inferSelect,
    version: typeof message_versions.$inferSelect,
    preserveShell = false
  ) {
    const completed =
      (version.based_on === null
        ? undefined
        : db.orm
            .select()
            .from(message_versions)
            .where(
              and(
                eq(message_versions.id, version.based_on),
                eq(message_versions.message_id, message.id),
                eq(message_versions.status, 'complete')
              )
            )
            .get()) ??
      db.orm
        .select()
        .from(message_versions)
        .where(
          and(eq(message_versions.message_id, message.id), eq(message_versions.status, 'complete'))
        )
        .orderBy(desc(message_versions.number))
        .get();

    if (completed) {
      if (message.active_version_id === version.id)
        db.orm
          .update(messages)
          .set({ active_version_id: completed.id })
          .where(eq(messages.id, message.id))
          .run();

      db.orm.delete(message_versions).where(eq(message_versions.id, version.id)).run();
    } else if (preserveShell) {
      db.orm
        .update(messages)
        .set({ active_version_id: null })
        .where(eq(messages.id, message.id))
        .run();
      db.orm.delete(message_versions).where(eq(message_versions.id, version.id)).run();
    } else db.orm.delete(messages).where(eq(messages.id, message.id)).run();
  }

  return discardPending;
}
