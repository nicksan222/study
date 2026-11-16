/** @file Owns generation events within this feature. */

import type { NoteId, replyRequestSchema } from '@study/contracts';
import type { Transaction } from '@study/server';
import { Option } from 'effect';

import { TitleStore } from '#server/features/notes/store/title';

/** Captures at most one automatic title request per provisional note revision. */
export function scheduleAutomaticTitle(tx: Transaction, noteId: NoteId) {
  const requestId = crypto.randomUUID();
  const snapshot = tx.store(TitleStore).captureAutomaticTitle({ noteId, requestId });

  if (Option.isSome(snapshot))
    tx.emit({
      type: 'NoteTitleRequested',
      eventId: crypto.randomUUID(),
      causationId: null,
      correlationId: requestId,
      inputVersion: 1,
      depth: 0,
      ...snapshot.value
    });
}

export function emitReplyRequest(
  tx: Transaction,
  result: typeof replyRequestSchema.Type,
  operation: 'reply' | 'rewrite'
) {
  tx.emit({
    type: 'NoteGenerationRequested',
    eventId: crypto.randomUUID(),
    causationId: null,
    correlationId: result.requestId,
    inputVersion: 1,
    depth: 0,
    ...result,
    operation
  });
}
