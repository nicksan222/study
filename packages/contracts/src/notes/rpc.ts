import { Schema } from 'effect';

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
import { noteStudyInputSchema } from '../inputs.ts';
import { allDependencies, dependency, endpointGroup, liveQuery, mutation } from '../protocol.ts';
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

export const countNotesInputSchema = Schema.Struct({ project: notePageInputSchema.fields.project });

export const notesEndpoints = {
  count: liveQuery(
    'notes.count',
    { payload: countNotesInputSchema, success: Schema.BigInt, error: failureSchema },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  mergeNotes: mutation(
    'notes.mergeNotes',
    {
      payload: mergeNotesInputSchema,
      success: noteSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  newAssistantNote: mutation(
    'notes.newAssistantNote',
    {
      payload: assistantChatStartSchema,
      success: noteSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  assistantChats: liveQuery(
    'notes.assistantChats',
    {
      payload: assistantChatsInputSchema,
      success: assistantChatsSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  assistantContext: liveQuery(
    'notes.assistantContext',
    {
      payload: assistantContextInputSchema,
      success: assistantContextSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  suggestTransformField: mutation(
    'notes.suggestTransformField',
    {
      payload: transformSuggestionInputSchema,
      success: Schema.String,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  setMessageKind: mutation(
    'notes.setMessageKind',
    {
      payload: setMessageKindInputSchema,
      success: chatMessageSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  answerQuestion: mutation(
    'notes.answerQuestion',
    {
      payload: questionVersionInputSchema,
      success: replyRequestSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  setNoteSettled: mutation(
    'notes.setNoteSettled',
    {
      payload: setNoteSettledInputSchema,
      success: Schema.Struct({}),
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  noteWork: liveQuery(
    'notes.noteWork',
    {
      payload: noteWorkInputSchema,
      success: noteWorkPageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  noteSummaries: liveQuery(
    'notes.noteSummaries',
    {
      payload: {},
      success: noteSummariesSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  ask: mutation(
    'notes.ask',
    { payload: askInputSchema, success: askResultSchema, error: failureSchema },
    { changes: [dependency.notes] }
  ),
  replyVersion: liveQuery(
    'notes.replyVersion',
    {
      payload: replyVersionInputSchema,
      success: replyVersionSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  archivedItems: liveQuery(
    'notes.archivedItems',
    {
      payload: noteArchiveInputSchema,
      success: Schema.Array(archivedNoteItemSchema),
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  setItemArchived: mutation(
    'notes.setItemArchived',
    {
      payload: setNoteItemArchivedSchema,
      success: Schema.Void,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  noteSelection: liveQuery(
    'notes.noteSelection',
    {
      payload: noteSelectionInputSchema,
      success: noteSelectionSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  updateNoteSelection: mutation(
    'notes.updateNoteSelection',
    {
      payload: updateNoteSelectionSchema,
      success: noteSelectionSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  captureStudyEvidence: mutation(
    'notes.captureStudyEvidence',
    {
      payload: { noteId: noteIdSchema, projectId: projectIdSchema },
      success: noteStudyInputSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  captureNoteContext: mutation(
    'notes.captureNoteContext',
    {
      payload: captureNoteContextSchema,
      success: runSelectionContextSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  inspectNoteContext: liveQuery(
    'notes.inspectNoteContext',
    {
      payload: replySnapshotInputSchema,
      success: runSelectionContextSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  noteContext: liveQuery(
    'notes.noteContext',
    {
      payload: replySnapshotInputSchema,
      success: runSelectionContextSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  replySnapshot: liveQuery(
    'notes.replySnapshot',
    {
      payload: replySnapshotInputSchema,
      success: replySnapshotSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  createUntitledNote: mutation(
    'notes.createUntitledNote',
    {
      payload: createUntitledNoteInputSchema,
      success: noteSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  requestTitle: mutation(
    'notes.requestTitle',
    {
      payload: replyRequestInputSchema,
      success: titleRequestSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  requestReply: mutation(
    'notes.requestReply',
    {
      payload: replyRequestInputSchema,
      success: replyRequestSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  reanswer: mutation(
    'notes.reanswer',
    {
      payload: reanswerInputSchema,
      success: replyRequestSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  convertMessage: mutation(
    'notes.convertMessage',
    {
      payload: convertMessageInputSchema,
      success: replyRequestSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  rewriteMessage: mutation(
    'notes.rewriteMessage',
    {
      payload: rewriteMessageInputSchema,
      success: replyRequestSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  message: liveQuery(
    'notes.message',
    {
      payload: messageIdInputSchema,
      success: chatMessageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  thread: liveQuery(
    'notes.thread',
    {
      payload: threadInputSchema,
      success: threadPageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  postMessage: mutation(
    'notes.postMessage',
    {
      payload: postMessageInputSchema,
      success: chatMessageSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  updateMessageDescription: mutation(
    'notes.updateMessageDescription',
    {
      payload: updateMessageDescriptionInputSchema,
      success: chatMessageSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  editMessage: mutation(
    'notes.editMessage',
    {
      payload: editMessageInputSchema,
      success: chatMessageSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  deleteMessage: mutation(
    'notes.deleteMessage',
    {
      payload: messageIdInputSchema,
      success: Schema.Boolean,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  deleteMessageVersion: mutation(
    'notes.deleteMessageVersion',
    {
      payload: setActiveVersionInputSchema,
      success: chatMessageSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  setActiveVersion: mutation(
    'notes.setActiveVersion',
    {
      payload: setActiveVersionInputSchema,
      success: chatMessageSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  rename: mutation(
    'notes.renameNote',
    {
      payload: renameNoteInputSchema,
      success: noteSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  assistantAsk: mutation(
    'notes.assistantAsk',
    {
      payload: assistantAskInputSchema,
      success: askResultSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  noteAssistant: liveQuery(
    'notes.noteAssistant',
    {
      payload: noteAssistantInputSchema,
      success: noteSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  assistantNote: liveQuery(
    'notes.assistantNote',
    {
      payload: assistantNoteInputSchema,
      success: noteSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  get: liveQuery(
    'notes.note',
    {
      payload: noteIdInputSchema,
      success: noteSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  find: liveQuery(
    'notes.findNote',
    {
      payload: noteIdInputSchema,
      success: Schema.Option(noteSchema),
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  noteGenerations: liveQuery(
    'notes.noteGenerations',
    {
      payload: noteGenerationPageInputSchema,
      success: noteGenerationPageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  messageVersionCitations: liveQuery(
    'notes.messageVersionCitations',
    {
      payload: replyVersionInputSchema,
      success: messageVersionCitationsSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  list: liveQuery(
    'notes.notes',
    {
      payload: notePageInputSchema,
      success: notePageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  create: mutation(
    'notes.createNote',
    {
      payload: createNoteInputSchema,
      success: noteSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  noteDeletion: liveQuery(
    'notes.noteDeletion',
    {
      payload: noteIdInputSchema,
      success: noteDeletionSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  retryNoteDeletion: mutation(
    'notes.retryNoteDeletion',
    {
      payload: noteIdInputSchema,
      success: noteDeletionSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  ),
  delete: mutation(
    'notes.deleteNote',
    {
      payload: noteIdInputSchema,
      success: noteDeletionSchema,
      error: failureSchema
    },
    { changes: [dependency.notes] }
  )
};

export const NotesRpc = endpointGroup(notesEndpoints);
