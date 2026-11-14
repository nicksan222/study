import type { NoteId, MessageId, SourceId } from '@study/contracts/ids';
import type { captureNoteContextSchema } from '@study/contracts/notes/context';
import type {
  editMessageInputSchema,
  setActiveVersionInputSchema
} from '@study/contracts/notes/rpc';
import type { rewriteMessageInputSchema, askInputSchema } from '@study/contracts/notes/schemas';
import type { transformRequestSchema } from '@study/contracts/pages/transform';
import { rpc } from '@study/contracts/react';

export type AskInput = typeof askInputSchema.Type;

export type TransformInput = typeof transformRequestSchema.Type;

export const ask = (input: AskInput) => rpc.notes.ask.call(input);

export const saveNote = (noteId: NoteId, text: string, sourceIds?: readonly SourceId[]) =>
  rpc.notes.postMessage.call({ noteId, text, sourceIds, requestReply: false });

export const captureContext = (input: typeof captureNoteContextSchema.Type) =>
  rpc.notes.captureNoteContext.call(input);

export const transformPage = (input: TransformInput) => rpc.pages.requestTransform.call(input);

export const cancelGeneration = (requestId: string) =>
  rpc.pages.cancelTransform.call({ requestId });

export const retryGeneration = (requestId: string, retryId: string) =>
  rpc.pages.retryTransform.call({ requestId, retryId });

export const deleteNote = (id: NoteId) => rpc.notes.delete.call({ id });

export const retryDeletion = (id: NoteId) => rpc.notes.retryNoteDeletion.call({ id });

export const uploadSource = async (file: File) =>
  rpc.sources.create.call({
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    projectId: null
  });

export const editNote = (input: typeof editMessageInputSchema.Type) =>
  rpc.notes.editMessage.call(input);

export const activateVersion = (input: typeof setActiveVersionInputSchema.Type) =>
  rpc.notes.setActiveVersion.call(input);

export const rewriteNote = (input: typeof rewriteMessageInputSchema.Type) =>
  rpc.notes.rewriteMessage.call(input);

export const reanswerNote = (messageId: MessageId) => rpc.notes.reanswer.call({ messageId });
