/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads a conversation’s ordered message history and associated source references.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps message ordering and source references in the persistence read model.            │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the conversations service applies policy and    │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { conversationMessageSnapshotSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import type { MessageId, PartId, SessionId } from '@study/contracts/ids';
import { and, desc, eq, isNull, lte } from '@study/db';
import { messages, message_versions } from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

/** Capture a bounded window of complete, selected versions without reading attachments. */
export function makeHistory({ db }: StoreResources) {
  function selectedMessages() {
    return db.orm
      .select({ message: messages, version: message_versions })
      .from(messages)
      .leftJoin(
        message_versions,
        and(
          eq(message_versions.id, messages.active_version_id),
          eq(message_versions.message_id, messages.id)
        )
      );
  }

  /** Captures complete selected versions; title callers may omit a pending assistant reply. */
  function conversationHistory(
    sessionId: SessionId,
    through?: MessageId,
    threadRoot?: PartId,
    allowEmpty = false,
    policy: { pendingAssistant?: 'omit' } = {}
  ) {
    const rows = selectedMessages()
      .where(
        and(
          eq(messages.session_id, sessionId),
          threadRoot === undefined
            ? isNull(messages.thread_root)
            : eq(messages.thread_root, threadRoot),
          through === undefined ? undefined : lte(messages.id, through)
        )
      )
      .orderBy(desc(messages.id))
      .limit(50)
      .all()
      .filter(
        ({ message, version }) =>
          !(
            policy.pendingAssistant === 'omit' &&
            message.role === 'assistant' &&
            version?.status === 'pending'
          )
      );
    let remaining = 200_000;
    const history: Array<typeof conversationMessageSnapshotSchema.Type> = [];

    for (const { message, version } of rows) {
      if (!version || version.status !== 'complete')
        throw new StudyError('invalid_input', 'conversation has an unfinished message');

      if (version.text.length > remaining) {
        if (!history.length)
          throw new StudyError('invalid_input', 'message exceeds conversation context limit');

        break;
      }

      remaining -= version.text.length;
      history.push({
        messageId: message.id,
        versionId: version.id,
        role: message.role,
        text: version.text
      });
    }

    if (!history.length && !allowEmpty)
      throw new StudyError('invalid_input', 'conversation has no complete messages');

    return history.reverse();
  }

  /** Read a specific complete message for use as an attachment thread's root. */
  function conversationRoot(sessionId: SessionId, messageId: MessageId) {
    const row = selectedMessages()
      .where(
        and(
          eq(messages.session_id, sessionId),
          eq(messages.id, messageId),
          isNull(messages.thread_root)
        )
      )
      .get();

    if (!row?.version || row.version.status !== 'complete')
      throw new StudyError('invalid_input', 'thread root is unavailable');

    return {
      messageId: row.message.id,
      versionId: row.version.id,
      role: row.message.role,
      text: row.version.text
    };
  }

  /** Titles use complete context while an assistant reply is still being generated. */
  function titleHistory(sessionId: SessionId) {
    return conversationHistory(sessionId, undefined, undefined, false, {
      pendingAssistant: 'omit'
    });
  }

  return { conversationHistory, conversationRoot, titleHistory };
}
