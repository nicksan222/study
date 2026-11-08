/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Maps typed note RPC requests to their corresponding note service                   │
 * │ operations.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Delegates request handling to the note service without owning domain rules.            │
 * │ - Preserves the public contract while delegating domain behavior to the service.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ RPC schemas come from @study/contracts; domain decisions and persistence remain owned by │
 * │ the notes service.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { NotesRpc } from '@study/contracts/notes/rpc';

import { Notes } from '#server/features/notes/service/index';
import { suggestTransformField } from '#server/features/notes/service/transform-suggestion';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const NotesRpcLive = defineRpc(NotesRpc, { notes: Notes }, ({ notes }) => ({
  'notes.mergeNotes': notes.mergeNotes,
  'notes.suggestTransformField': suggestTransformField,
  'notes.setMessageKind': notes.setMessageKind,
  'notes.answerQuestion': notes.answerQuestion,
  'notes.archivedItems': notes.archivedItems,
  'notes.setItemArchived': notes.setItemArchived,
  'notes.noteSelection': notes.noteSelection,
  'notes.updateNoteSelection': notes.updateNoteSelection,
  'notes.captureNoteContext': notes.captureNoteContext,
  'notes.inspectNoteContext': notes.inspectNoteContext,
  'notes.noteContext': notes.noteContext,
  'notes.replySnapshot': notes.inspectReplySnapshot,
  'notes.createUntitledNote': notes.createUntitledNote,
  'notes.requestTitle': notes.requestTitle,
  'notes.ask': notes.ask,
  'notes.messageVersionCitations': notes.messageVersionCitations,
  'notes.noteGenerations': notes.noteGenerations,
  'notes.replyVersion': notes.replyVersion,
  'notes.requestReply': notes.requestReply,
  'notes.reanswer': notes.reanswer,
  'notes.convertMessage': notes.convertMessage,
  'notes.rewriteMessage': notes.rewriteMessage,
  'notes.message': ({ id }) => notes.message(id),
  'notes.thread': notes.thread,
  'notes.postMessage': notes.postMessage,
  'notes.updateMessageDescription': notes.updateMessageDescription,
  'notes.editMessage': notes.editMessage,
  'notes.deleteMessageVersion': notes.deleteMessageVersion,
  'notes.deleteMessage': ({ id }) => notes.deleteMessage(id),
  'notes.setActiveVersion': notes.setActiveVersion,
  'notes.renameNote': notes.renameNote,
  'notes.assistantAsk': notes.assistantAsk,
  'notes.noteAssistant': notes.noteAssistant,
  'notes.assistantNote': notes.assistantNote,
  'notes.newAssistantNote': notes.newAssistantNote,
  'notes.assistantChats': notes.assistantChats,
  'notes.assistantContext': notes.assistantContext,
  'notes.note': ({ id }) => notes.note(id),
  'notes.findNote': ({ id }) => notes.findNote(id),
  'notes.setNoteSettled': notes.setNoteSettled,
  'notes.noteWork': notes.noteWork,
  'notes.noteSummaries': notes.noteSummaries,
  'notes.notes': notes.notes,
  'notes.createNote': notes.createNote,
  'notes.noteDeletion': ({ id }) => notes.noteDeletion(id),
  'notes.retryNoteDeletion': ({ id }) => notes.retryNoteDeletion(id),
  'notes.deleteNote': ({ id }) => notes.deleteNote(id)
}));
