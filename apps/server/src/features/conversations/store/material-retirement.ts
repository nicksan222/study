/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Removes private captures affected by Material deletion without deleting session    │
 * │ messages.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps exact deletion behavior behind the owning feature boundary.                      │
 * │ - Preserves durable identities without retaining private captured content.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns execution; public participants coordinate synchronous feature       │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { selectionTargetsSchema } from '@study/contracts/conversations/context';
import type { MaterialVersionId } from '@study/contracts/ids';
import { eq } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeDiscardPending } from './pending.ts';

const selectionCodec = Schema.fromJsonString(Schema.toCodecJson(selectionTargetsSchema));

export function makeMaterialRetirement(resources: StoreResources) {
  const { db } = resources;
  const discardPending = makeDiscardPending(resources);

  function scrubRequest(requestId: string) {
    const reply = db.orm
      .select({ message: s.messages, version: s.message_versions })
      .from(s.conversation_reply_requests)
      .innerJoin(
        s.message_versions,
        eq(s.message_versions.id, s.conversation_reply_requests.version_id)
      )
      .innerJoin(s.messages, eq(s.messages.id, s.message_versions.message_id))
      .where(eq(s.conversation_reply_requests.request_id, requestId))
      .get();

    if (reply && reply.version.status !== 'complete') discardPending(reply.message, reply.version);

    db.orm
      .delete(s.conversation_reply_requests)
      .where(eq(s.conversation_reply_requests.request_id, requestId))
      .run();

    db.orm
      .delete(s.session_run_contexts)
      .where(eq(s.session_run_contexts.request_id, requestId))
      .run();
  }

  function removeSelections(versionIds: readonly MaterialVersionId[]) {
    for (const session of db.orm.select().from(s.sessions).all()) {
      const previous = Schema.decodeUnknownSync(selectionCodec)(session.selection);
      const selected = previous.filter((target) => !versionIds.includes(target.versionId));

      if (selected.length === previous.length) continue;

      db.orm
        .update(s.sessions)
        .set({
          selection: Schema.encodeSync(selectionCodec)(selected),
          selection_revision: session.selection_revision + 1n
        })
        .where(eq(s.sessions.id, session.id))
        .run();
    }
  }

  function selectedSessions(versionIds: readonly MaterialVersionId[]) {
    return db.orm
      .select()
      .from(s.sessions)
      .all()
      .filter((session) =>
        Schema.decodeUnknownSync(selectionCodec)(session.selection).some((target) =>
          versionIds.includes(target.versionId)
        )
      );
  }

  return { scrubRequest, removeSelections, selectedSessions };
}
