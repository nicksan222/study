import type {
  NoteId,
  MessageId,
  SourceId,
  captureNoteContextSchema,
  editMessageInputSchema,
  setActiveVersionInputSchema,
  rewriteMessageInputSchema,
  askInputSchema,
  transformRequestSchema
} from '@study/contracts';
import { rpc } from '@study/contracts/react';
import type { RpcCallOptions } from '@study/contracts/react';

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

export async function uploadSource(file: File, options?: RpcCallOptions) {
  options?.signal?.throwIfAborted();
  const bytes = new Uint8Array(await file.arrayBuffer());

  return rpc.sources.create.call({ name: file.name, bytes, projectId: null }, options);
}

export const editNote = (input: typeof editMessageInputSchema.Type) =>
  rpc.notes.editMessage.call(input);

export const activateVersion = (input: typeof setActiveVersionInputSchema.Type) =>
  rpc.notes.setActiveVersion.call(input);

export const rewriteNote = (input: typeof rewriteMessageInputSchema.Type) =>
  rpc.notes.rewriteMessage.call(input);

export const reanswerNote = (messageId: MessageId) => rpc.notes.reanswer.call({ messageId });
