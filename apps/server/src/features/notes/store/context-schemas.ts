/** @file Owns context schemas within this feature. */

import {
  StudyError,
  noteContextIntentSchema,
  runSelectionContextSchema,
  selectionTargetsSchema
} from '@study/contracts';
import { Schema } from 'effect';

export const targetsCodec = Schema.fromJsonString(Schema.toCodecJson(selectionTargetsSchema));

export const contextCodec = Schema.fromJsonString(Schema.toCodecJson(runSelectionContextSchema));

export const intentCodec = Schema.fromJsonString(Schema.toCodecJson(noteContextIntentSchema));

export const sameIntent = Schema.toEquivalence(noteContextIntentSchema);

export function assertHistoryBoundary(
  history: typeof runSelectionContextSchema.Type.messages,
  throughMessageId: typeof noteContextIntentSchema.Type.throughMessageId
) {
  if (throughMessageId !== undefined && history.at(-1)?.messageId !== throughMessageId)
    throw new StudyError('invalid_input', 'Note boundary is unavailable in this scope');
}

export function canonicalIntent(input: typeof noteContextIntentSchema.Type) {
  return {
    noteId: input.noteId,
    additionalNoteIds: input.additionalNoteIds,
    threadRoot: input.threadRoot,
    throughMessageId: input.askDigest ? undefined : input.throughMessageId,
    askDigest: input.askDigest,
    intentKey: input.intentKey,
    instruction: input.instruction,
    preferences: {
      language: input.preferences.language,
      detail: input.preferences.detail
    }
  };
}
