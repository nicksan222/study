/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Removes explicitly retired private conversation captures without deleting session    │
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

import { eq } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeDiscardPending } from './pending.ts';

export function makeContextRetirement(resources: StoreResources) {
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

    // Older generated versions obtain their content-free identity before payload removal.
    if (
      reply &&
      reply.version.status === 'complete' &&
      reply.version.generation_request_id === null
    )
      db.orm
        .update(s.message_versions)
        .set({ generation_request_id: requestId })
        .where(eq(s.message_versions.id, reply.version.id))
        .run();

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

  return { scrubRequest };
}
