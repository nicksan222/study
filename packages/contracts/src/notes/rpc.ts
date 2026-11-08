import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import {
  pageVersionIdSchema,
  messageIdSchema,
  partIdSchema,
  projectIdSchema,
  noteIdSchema,
  sourceIdSchema,
  versionIdSchema
} from '../ids.ts';
import {
  noteArchiveInputSchema,
  setNoteItemArchivedSchema,
  archivedNoteItemSchema
} from './archive.ts';
import {
  assistantNoteInputSchema,
  noteAssistantInputSchema,
  assistantChatStartSchema,
  assistantChatsInputSchema,
  assistantChatsSchema,
  assistantContextInputSchema,
  assistantContextSchema
} from './assistant.ts';
import {
  noteSelectionInputSchema,
  noteSelectionSchema,
  updateNoteSelectionSchema,
  captureNoteContextSchema,
  runSelectionContextSchema
} from './context.ts';
import { convertMessageInputSchema } from './conversion.ts';
import { noteDeletionSchema } from './deletion.ts';
import { noteSummariesSchema } from './schemas.ts';
import {
  captureKeySchema,
  transformSuggestionFieldSchema,
  transformSuggestionLanguageSchema
} from './schemas.ts';
import {
  questionVersionInputSchema,
  setMessageKindInputSchema,
  messageDescriptionSchema,
  messageFormatSchema,
  replySnapshotInputSchema,
  replySnapshotSchema,
  chatMessageSchema,
  noteSchema,
  replyRequestInputSchema,
  replyRequestSchema,
  reanswerInputSchema,
  rewriteMessageInputSchema,
  askInputSchema,
  askResultSchema,
  replyVersionInputSchema,
  replyVersionSchema,
  titleRequestSchema
} from './schemas.ts';
import { noteWorkInputSchema, noteWorkPageSchema } from './work.ts';

export const noteGenerationPageInputSchema = Schema.Struct({
  noteId: noteIdSchema,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)))
});

export const noteGenerationSchema = Schema.Struct({
  requestId: Schema.String,
  contextRequestId: Schema.NullOr(Schema.String),
  state: Schema.Literals(['available', 'retired', 'unavailable']),
  cancelled: Schema.Boolean,
  resultVersionId: Schema.NullOr(pageVersionIdSchema),
  proposedVersionId: Schema.NullOr(pageVersionIdSchema),
  baseVersionId: Schema.NullOr(pageVersionIdSchema)
});

const noteGenerationPageSchema = Schema.Struct({
  items: Schema.Array(noteGenerationSchema),
  next: Schema.NullOr(Schema.String)
});

export const messageVersionCitationsSchema = Schema.Struct({
  noteId: noteIdSchema,
  messageId: messageIdSchema,
  versionId: versionIdSchema,
  citations: chatMessageSchema.fields.citations
});

const noteCursorSchema = Schema.Struct({ updatedAt: Schema.BigInt, id: noteIdSchema });

export const setNoteSettledInputSchema = Schema.Struct({
  id: noteIdSchema,
  settled: Schema.Boolean
});

export const notePageInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  project: Schema.optional(Schema.NullOr(projectIdSchema)),
  before: Schema.optional(noteCursorSchema)
});

export const notePageSchema = Schema.Struct({
  items: Schema.Array(noteSchema),
  next: Schema.NullOr(noteCursorSchema)
});

export const noteIdInputSchema = Schema.Struct({ id: noteIdSchema });

export const assistantAskInputSchema = Schema.Struct({
  noteId: Schema.optional(noteIdSchema),
  text: Schema.String.check(Schema.isBetweenLength(1, 100000)),
  intentKey: Schema.String.check(Schema.isBetweenLength(1, 200))
});

export const createNoteInputSchema = Schema.Struct({
  project: Schema.optional(projectIdSchema),
  title: Schema.String
});

export const createUntitledNoteInputSchema = Schema.Struct({
  project: Schema.optional(projectIdSchema),
  initialMessage: Schema.optional(
    Schema.Struct({
      text: Schema.String,
      sourceIds: Schema.optional(Schema.Array(sourceIdSchema))
    })
  )
});

const messageIdInputSchema = Schema.Struct({ id: messageIdSchema });

export const threadInputSchema = Schema.Struct({
  noteId: noteIdSchema,
  threadRoot: Schema.optional(partIdSchema),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(messageIdSchema)
});

export const threadPageSchema = Schema.Struct({
  items: Schema.Array(chatMessageSchema),
  next: Schema.NullOr(messageIdSchema)
});

export const postMessageInputSchema = Schema.Struct({
  format: Schema.optional(messageFormatSchema),
  captureKey: Schema.optional(captureKeySchema),
  noteId: noteIdSchema,
  threadRoot: Schema.optional(partIdSchema),
  requestReply: Schema.optional(Schema.Boolean),
  text: Schema.String,
  sourceIds: Schema.optional(Schema.Array(sourceIdSchema))
});

export const editMessageInputSchema = Schema.Struct({
  expectedActiveVersionId: Schema.optional(versionIdSchema),
  messageId: messageIdSchema,
  text: Schema.String
});

export const updateMessageDescriptionInputSchema = Schema.Struct({
  messageId: messageIdSchema,
  description: Schema.NullOr(messageDescriptionSchema),
  expectedDescription: Schema.NullOr(messageDescriptionSchema)
});

export const setActiveVersionInputSchema = Schema.Struct({
  messageId: messageIdSchema,
  versionId: versionIdSchema
});

export const mergeNotesInputSchema = Schema.Struct({
  noteIds: Schema.Array(noteIdSchema).check(Schema.isBetweenLength(2, 20)),
  intentKey: Schema.String.check(Schema.isBetweenLength(1, 200))
});

export const renameNoteInputSchema = Schema.Struct({
  id: noteIdSchema,
  title: Schema.String
});

export const transformSuggestionInputSchema = Schema.Struct({
  noteId: noteIdSchema,
  additionalNoteIds: Schema.optional(Schema.Array(noteIdSchema).check(Schema.isMaxLength(19))),
  intentKey: Schema.String.check(Schema.isBetweenLength(1, 160)),
  field: transformSuggestionFieldSchema,
  language: transformSuggestionLanguageSchema
});

export const NotesRpc = RpcGroup.make(
  Rpc.make('mergeNotes', {
    payload: mergeNotesInputSchema,
    success: noteSchema,
    error: failureSchema
  }),
  Rpc.make('newAssistantNote', {
    payload: assistantChatStartSchema,
    success: noteSchema,
    error: failureSchema
  }),
  Rpc.make('assistantChats', {
    payload: assistantChatsInputSchema,
    success: assistantChatsSchema,
    error: failureSchema
  }),
  Rpc.make('assistantContext', {
    payload: assistantContextInputSchema,
    success: assistantContextSchema,
    error: failureSchema
  }),

  Rpc.make('suggestTransformField', {
    payload: transformSuggestionInputSchema,
    success: Schema.String,
    error: failureSchema
  }),
  Rpc.make('setMessageKind', {
    payload: setMessageKindInputSchema,
    success: chatMessageSchema,
    error: failureSchema
  }),
  Rpc.make('answerQuestion', {
    payload: questionVersionInputSchema,
    success: replyRequestSchema,
    error: failureSchema
  }),
  Rpc.make('setNoteSettled', {
    payload: setNoteSettledInputSchema,
    success: Schema.Struct({}),
    error: failureSchema
  }),
  Rpc.make('noteWork', {
    payload: noteWorkInputSchema,
    success: noteWorkPageSchema,
    error: failureSchema
  }),
  Rpc.make('noteSummaries', {
    payload: {},
    success: noteSummariesSchema,
    error: failureSchema
  }),
  Rpc.make('ask', { payload: askInputSchema, success: askResultSchema, error: failureSchema }),
  Rpc.make('replyVersion', {
    payload: replyVersionInputSchema,
    success: replyVersionSchema,
    error: failureSchema
  }),
  Rpc.make('archivedItems', {
    payload: noteArchiveInputSchema,
    success: Schema.Array(archivedNoteItemSchema),
    error: failureSchema
  }),
  Rpc.make('setItemArchived', {
    payload: setNoteItemArchivedSchema,
    success: Schema.Void,
    error: failureSchema
  }),
  Rpc.make('noteSelection', {
    payload: noteSelectionInputSchema,
    success: noteSelectionSchema,
    error: failureSchema
  }),
  Rpc.make('updateNoteSelection', {
    payload: updateNoteSelectionSchema,
    success: noteSelectionSchema,
    error: failureSchema
  }),
  Rpc.make('captureNoteContext', {
    payload: captureNoteContextSchema,
    success: runSelectionContextSchema,
    error: failureSchema
  }),
  Rpc.make('inspectNoteContext', {
    payload: replySnapshotInputSchema,
    success: runSelectionContextSchema,
    error: failureSchema
  }),
  Rpc.make('noteContext', {
    payload: replySnapshotInputSchema,
    success: runSelectionContextSchema,
    error: failureSchema
  }),
  Rpc.make('replySnapshot', {
    payload: replySnapshotInputSchema,
    success: replySnapshotSchema,
    error: failureSchema
  }),
  Rpc.make('createUntitledNote', {
    payload: createUntitledNoteInputSchema,
    success: noteSchema,
    error: failureSchema
  }),
  Rpc.make('requestTitle', {
    payload: replyRequestInputSchema,
    success: titleRequestSchema,
    error: failureSchema
  }),
  Rpc.make('requestReply', {
    payload: replyRequestInputSchema,
    success: replyRequestSchema,
    error: failureSchema
  }),
  Rpc.make('reanswer', {
    payload: reanswerInputSchema,
    success: replyRequestSchema,
    error: failureSchema
  }),
  Rpc.make('convertMessage', {
    payload: convertMessageInputSchema,
    success: replyRequestSchema,
    error: failureSchema
  }),
  Rpc.make('rewriteMessage', {
    payload: rewriteMessageInputSchema,
    success: replyRequestSchema,
    error: failureSchema
  }),
  Rpc.make('message', {
    payload: messageIdInputSchema,
    success: chatMessageSchema,
    error: failureSchema
  }),
  Rpc.make('thread', {
    payload: threadInputSchema,
    success: threadPageSchema,
    error: failureSchema
  }),
  Rpc.make('postMessage', {
    payload: postMessageInputSchema,
    success: chatMessageSchema,
    error: failureSchema
  }),
  Rpc.make('updateMessageDescription', {
    payload: updateMessageDescriptionInputSchema,
    success: chatMessageSchema,
    error: failureSchema
  }),
  Rpc.make('editMessage', {
    payload: editMessageInputSchema,
    success: chatMessageSchema,
    error: failureSchema
  }),
  Rpc.make('deleteMessage', {
    payload: messageIdInputSchema,
    success: Schema.Boolean,
    error: failureSchema
  }),
  Rpc.make('deleteMessageVersion', {
    payload: setActiveVersionInputSchema,
    success: chatMessageSchema,
    error: failureSchema
  }),
  Rpc.make('setActiveVersion', {
    payload: setActiveVersionInputSchema,
    success: chatMessageSchema,
    error: failureSchema
  }),
  Rpc.make('renameNote', {
    payload: renameNoteInputSchema,
    success: noteSchema,
    error: failureSchema
  }),
  Rpc.make('assistantAsk', {
    payload: assistantAskInputSchema,
    success: askResultSchema,
    error: failureSchema
  }),
  Rpc.make('noteAssistant', {
    payload: noteAssistantInputSchema,
    success: noteSchema,
    error: failureSchema
  }),
  Rpc.make('assistantNote', {
    payload: assistantNoteInputSchema,
    success: noteSchema,
    error: failureSchema
  }),
  Rpc.make('note', {
    payload: noteIdInputSchema,
    success: noteSchema,
    error: failureSchema
  }),
  Rpc.make('findNote', {
    payload: noteIdInputSchema,
    success: Schema.Option(noteSchema),
    error: failureSchema
  }),
  Rpc.make('noteGenerations', {
    payload: noteGenerationPageInputSchema,
    success: noteGenerationPageSchema,
    error: failureSchema
  }),
  Rpc.make('messageVersionCitations', {
    payload: replyVersionInputSchema,
    success: messageVersionCitationsSchema,
    error: failureSchema
  }),
  Rpc.make('notes', {
    payload: notePageInputSchema,
    success: notePageSchema,
    error: failureSchema
  }),
  Rpc.make('createNote', {
    payload: createNoteInputSchema,
    success: noteSchema,
    error: failureSchema
  }),
  Rpc.make('noteDeletion', {
    payload: noteIdInputSchema,
    success: noteDeletionSchema,
    error: failureSchema
  }),
  Rpc.make('retryNoteDeletion', {
    payload: noteIdInputSchema,
    success: noteDeletionSchema,
    error: failureSchema
  }),
  Rpc.make('deleteNote', {
    payload: noteIdInputSchema,
    success: noteDeletionSchema,
    error: failureSchema
  })
).prefix('notes.');
