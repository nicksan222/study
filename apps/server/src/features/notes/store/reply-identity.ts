/** @file Owns reply identity within this feature. */

import type {
  publishReplyInputSchema,
  replySnapshotSchema,
  replyVersionInputSchema,
  runPreferencesSchema,
  versionIdSchema
} from '@study/contracts';
import { NoteMode } from '@study/contracts';
import type { note_reply_requests, notes } from '@study/db';
import { and, eq, message_versions, messages } from '@study/db';
import { text } from '@study/localization';

export function replyTargetPredicate(input: typeof replyVersionInputSchema.Type) {
  return and(
    eq(message_versions.id, input.versionId),
    eq(messages.id, input.messageId),
    eq(messages.note_id, input.noteId)
  );
}

export function matchesRequest(
  snapshot: typeof replySnapshotSchema.Type,
  row: typeof note_reply_requests.$inferSelect
) {
  return (
    snapshot.requestId === row.request_id &&
    snapshot.noteId === row.note_id &&
    snapshot.versionId === row.version_id
  );
}

export function generationMatches(
  version: typeof message_versions.$inferSelect,
  snapshot: typeof replySnapshotSchema.Type,
  role: typeof messages.$inferSelect.role
) {
  return (
    validAnswerGeneration(version, snapshot, role) &&
    version.origin === (snapshot.generation?.origin ?? 'answer') &&
    version.instruction ===
      (snapshot.generation?.origin === 'instruction' ? snapshot.generation.instruction : null)
  );
}

function validAnswerGeneration(
  version: typeof message_versions.$inferSelect,
  snapshot: typeof replySnapshotSchema.Type,
  role: typeof messages.$inferSelect.role
) {
  if (version.origin !== 'answer' || role === 'assistant') return true;

  return role === 'user' && version.based_on === snapshot.generation?.questionVersionId;
}

export function isAnswerTarget(
  message: typeof messages.$inferSelect | undefined,
  questionVersionId?: typeof versionIdSchema.Type
) {
  if (!message) return false;

  if (questionVersionId)
    return message.role === 'user' && message.active_version_id === questionVersionId;

  return message.role === 'assistant' && message.reply_to !== null;
}

export function answerPublicationText(
  snapshot: typeof replySnapshotSchema.Type,
  input: typeof publishReplyInputSchema.Type & {
    language?: typeof runPreferencesSchema.Type.language;
  }
) {
  if (!snapshot.generation?.questionVersionId) return input.text;

  const language = snapshot.context?.preferences.language ?? input.language ?? 'english';

  return `**${text(language, 'NoteQuestion')}**\n\n${snapshot.messages.at(-1)!.text}\n\n**${text(language, 'NoteAnswer')}**\n\n${input.text}`;
}

/** Questions and conversions retain their original selection until publication. */
export function keepsOriginalSelection(
  target: { questionVersionId?: unknown; conversion?: unknown } | undefined
) {
  return (
    target !== undefined &&
    (target.questionVersionId !== undefined || target.conversion !== undefined)
  );
}

/** Exact conversions survive unrelated edits while noteal captures stay fenced. */
export function replyContextMatches(
  snapshot: typeof replySnapshotSchema.Type,
  note: typeof notes.$inferSelect
) {
  return (
    snapshot.context !== undefined ||
    snapshot.generation?.conversion !== undefined ||
    note.context_revision === snapshot.contextRevision
  );
}

/** Matches either the captured conversion parent or the expected reply selection. */
export function replyVersionSelection(
  target: typeof messages.$inferSelect,
  version: typeof message_versions.$inferSelect,
  snapshot: typeof replySnapshotSchema.Type
) {
  if (snapshot.generation?.conversion)
    return version.based_on === snapshot.generation.conversion.baseVersionId;

  return (
    target.active_version_id === (snapshot.generation?.questionVersionId ?? snapshot.versionId)
  );
}

/** Requires an active generation version that still belongs to the captured note and selection. */
export function replySelectionMatches(
  target: typeof messages.$inferSelect | undefined,
  version: typeof message_versions.$inferSelect | undefined,
  result: typeof replySnapshotSchema.Type
) {
  if (!target || !version) return false;

  return (
    target.note_id === result.noteId &&
    version.message_id === result.messageId &&
    (version.status === 'pending' || version.status === 'writing') &&
    replyVersionSelection(target, version, result)
  );
}

/** Ungrounded chat and faithful conversions preserve bracketed text without invented citations. */
export function allowsLiteralReferences(
  snapshot: typeof replySnapshotSchema.Type,
  mode: NoteMode | undefined
) {
  return mode === NoteMode.Assistant || snapshot.generation?.conversion !== undefined;
}
