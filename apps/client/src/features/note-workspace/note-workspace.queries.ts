import type {
  NoteId,
  MessageId,
  SourceId,
  editMessageInputSchema,
  setActiveVersionInputSchema,
  rewriteMessageInputSchema,
  askInputSchema
} from '@study/contracts';
import { rpc } from '@study/contracts/react';

export type AskInput = typeof askInputSchema.Type;

export const ask = (input: AskInput) => rpc.notes.ask.call(input);

export const saveNote = (noteId: NoteId, text: string, sourceIds?: readonly SourceId[]) =>
  rpc.notes.postMessage.call({ noteId, text, sourceIds, requestReply: false });

export const deleteNote = (id: NoteId) => rpc.notes.delete.call({ id });

export const retryDeletion = (id: NoteId) => rpc.notes.retryNoteDeletion.call({ id });

export const editNote = (input: typeof editMessageInputSchema.Type) =>
  rpc.notes.editMessage.call(input);

export const activateVersion = (input: typeof setActiveVersionInputSchema.Type) =>
  rpc.notes.setActiveVersion.call(input);

export const rewriteNote = (input: typeof rewriteMessageInputSchema.Type) =>
  rpc.notes.rewriteMessage.call(input);

export const reanswerNote = (messageId: MessageId) => rpc.notes.reanswer.call({ messageId });
