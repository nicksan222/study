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
import { Effect } from 'effect';

import { Notes } from '#server/features/notes/service/index';
import { suggestTransformField } from '#server/features/notes/service/transform-suggestion';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const NotesRpcLive = defineRpc(
  NotesRpc,
  Effect.gen(function* () {
    const notes = yield* Notes;

    return {
      'notes.mergeNotes': (input) => notes.mergeNotes(input),
      'notes.suggestTransformField': suggestTransformField,
      'notes.setMessageKind': (input) => notes.setMessageKind(input),
      'notes.answerQuestion': (input) => notes.answerQuestion(input),
      'notes.archivedItems': (input) => notes.archivedItems(input),
      'notes.setItemArchived': (input) => notes.setItemArchived(input),
      'notes.noteSelection': (input) => notes.noteSelection(input),
      'notes.updateNoteSelection': (input) => notes.updateNoteSelection(input),
      'notes.captureNoteContext': (input) => notes.captureNoteContext(input),
      'notes.inspectNoteContext': (input) => notes.inspectNoteContext(input),
      'notes.noteContext': (input) => notes.noteContext(input),
      'notes.replySnapshot': (input) => notes.inspectReplySnapshot(input),
      'notes.createUntitledNote': (input) => notes.createUntitledNote(input),
      'notes.requestTitle': (input) => notes.requestTitle(input),
      'notes.ask': (input) => notes.ask(input),
      'notes.messageVersionCitations': (input) => notes.messageVersionCitations(input),
      'notes.noteGenerations': (input) => notes.noteGenerations(input),
      'notes.replyVersion': (input) => notes.replyVersion(input),
      'notes.requestReply': (input) => notes.requestReply(input),
      'notes.reanswer': (input) => notes.reanswer(input),
      'notes.convertMessage': (input) => notes.convertMessage(input),
      'notes.rewriteMessage': (input) => notes.rewriteMessage(input),
      'notes.message': ({ id }) => notes.message(id),
      'notes.thread': (input) => notes.thread(input),
      'notes.postMessage': (input) => notes.postMessage(input),
      'notes.updateMessageDescription': (input) => notes.updateMessageDescription(input),
      'notes.editMessage': (input) => notes.editMessage(input),
      'notes.deleteMessageVersion': (input) => notes.deleteMessageVersion(input),
      'notes.deleteMessage': ({ id }) => notes.deleteMessage(id),
      'notes.setActiveVersion': (input) => notes.setActiveVersion(input),
      'notes.renameNote': (input) => notes.renameNote(input),
      'notes.assistantAsk': (input) => notes.assistantAsk(input),
      'notes.noteAssistant': (input) => notes.noteAssistant(input),
      'notes.assistantNote': (input) => notes.assistantNote(input),
      'notes.newAssistantNote': (input) => notes.newAssistantNote(input),
      'notes.assistantChats': (input) => notes.assistantChats(input),
      'notes.assistantContext': (input) => notes.assistantContext(input),
      'notes.note': ({ id }) => notes.note(id),
      'notes.findNote': ({ id }) => notes.findNote(id),
      'notes.setNoteSettled': (input) => notes.setNoteSettled(input),
      'notes.noteWork': (input) => notes.noteWork(input),
      'notes.noteSummaries': (input) => notes.noteSummaries(input),
      'notes.notes': (input) => notes.notes(input),
      'notes.createNote': (input) => notes.createNote(input),
      'notes.noteDeletion': ({ id }) => notes.noteDeletion(id),
      'notes.retryNoteDeletion': ({ id }) => notes.retryNoteDeletion(id),
      'notes.deleteNote': ({ id }) => notes.deleteNote(id)
    };
  })
);
