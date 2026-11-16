/** @file Owns reply context within this feature. */

import type {
  ContentSnapshotId,
  SourceId,
  assistantMemorySchema,
  noteGenerationRequestedSchema,
  replySnapshotSchema,
  runPreferencesSchema,
  selectionRangeSchema,
  selectionReferenceSchema
} from '@study/contracts';
import { NoteMode, StudyError, selectionReferenceKey } from '@study/contracts';
import { Effect } from 'effect';

import { assistantAgent } from '#server/features/notes/agents/assistant';
import { noteAssistantAgent } from '#server/features/notes/agents/note-assistant';
import { replyAgent } from '#server/features/notes/agents/reply';
import { createEvidenceCatalog } from '#server/platform/ai/evidence';

export function selectionCatalog(snapshot: typeof replySnapshotSchema.Type) {
  const catalog = createEvidenceCatalog<{
    sourceId: SourceId | null;
    input: typeof selectionReferenceSchema.Type;
    selectedRange?: typeof selectionRangeSchema.Type;
    documentId: ContentSnapshotId;
  }>([]);

  for (const input of snapshot.context?.inputs ?? [])
    for (const [index, excerpt] of input.excerpts.entries())
      catalog.addDocument({
        key: `selection:${selectionReferenceKey(input.input)}:${index}`,
        name: input.name,
        quoteLimit: 100000,
        reference: {
          sourceId: input.input.kind === 'source' ? input.input.sourceId : null,
          input: input.input,
          selectedRange: {
            blockId: excerpt.blockId,
            start: excerpt.start,
            end: excerpt.end
          },
          documentId: input.snapshotId
        },
        blocks: [{ text: excerpt.text, blockOrdinal: excerpt.blockOrdinal }]
      });

  return catalog;
}

export function validateReplyEvent(
  snapshot: typeof replySnapshotSchema.Type,
  event: typeof noteGenerationRequestedSchema.Type
) {
  if (
    (snapshot.pendingAttachments?.length ?? 0) > 0 ||
    snapshot.requestId !== event.requestId ||
    snapshot.noteId !== event.noteId ||
    snapshot.messageId !== event.messageId ||
    snapshot.versionId !== event.versionId ||
    replyOperation(snapshot) !== event.operation
  )
    return Effect.fail(new StudyError('invalid_input', 'Reply event identity mismatch'));

  return Effect.void;
}

/** Classifies conversions with rewrites so their workflow status follows the target note. */
function replyOperation(snapshot: typeof replySnapshotSchema.Type) {
  return snapshot.generation?.origin === undefined || snapshot.generation.origin === 'answer'
    ? 'reply'
    : 'rewrite';
}

export function replyAgentForMode(
  mode: NoteMode,
  scopedNote?: typeof replySnapshotSchema.Type.noteId
) {
  if (scopedNote !== undefined) return noteAssistantAgent(scopedNote);

  return mode === NoteMode.Assistant ? assistantAgent : replyAgent;
}

export function replyMessages(
  mode: NoteMode,
  snapshot: typeof replySnapshotSchema.Type,
  preferences: typeof runPreferencesSchema.Type,
  memory: typeof assistantMemorySchema.Type | null
) {
  const messages = snapshot.messages
    .filter(
      (message) =>
        mode !== NoteMode.Assistant || !memory || message.messageId > memory.throughMessageId
    )
    .map((message) => ({
      role: message.role,
      content: message.text
    }));

  if (mode === NoteMode.Assistant && memory)
    return [
      {
        role: 'assistant' as const,
        content: 'Summary of earlier note (context, not a new request):\n' + memory.summary
      },
      ...messages
    ];

  if (mode === NoteMode.Assistant || !snapshot.context) return messages;

  return messages.concat([
    {
      role: 'user',
      content: snapshot.context.instruction + '\nPreferences: ' + JSON.stringify(preferences)
    }
  ]);
}

/** Keeps ordinary rewrite inputs separate from answers and registered conversions. */
export function rewriteGeneration(mode: NoteMode, snapshot: typeof replySnapshotSchema.Type) {
  if (mode === NoteMode.Assistant) return undefined;

  const generation = snapshot.generation;

  if (!generation || generation.origin === 'answer' || generation.origin === 'convert')
    return undefined;

  return { origin: generation.origin, instruction: generation.instruction };
}

export function replyConversion(snapshot: typeof replySnapshotSchema.Type) {
  return snapshot.generation?.conversion;
}
