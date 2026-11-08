import type { NoteId, MessageId, VersionId, ProjectId, SourceId } from '@study/contracts/ids';
import type { captureNoteContextSchema } from '@study/contracts/notes/context';
import type { transformSuggestionInputSchema } from '@study/contracts/notes/rpc';
import type {
  editMessageInputSchema,
  setActiveVersionInputSchema
} from '@study/contracts/notes/rpc';
import type { notePageInputSchema } from '@study/contracts/notes/rpc';
import type { rewriteMessageInputSchema } from '@study/contracts/notes/schemas';
import type { askInputSchema } from '@study/contracts/notes/schemas';
import type { transformRequestSchema } from '@study/contracts/pages/transform';
import {
  infiniteQueryOptions,
  queryOptions,
  mutationOptions,
  skipToken
} from '@tanstack/react-query';

import { toStudyError } from '#web/lib/study-client/errors.ts';
import { request } from '#web/lib/study-client/request.ts';

export type AskInput = typeof askInputSchema.Type;

export type TransformInput = typeof transformRequestSchema.Type;

type NoteCursor = (typeof notePageInputSchema.Type)['before'];

export const noteKey = (id: NoteId) => ['note-workspace', String(id)] as const;

export const paginatedNotesOptions = (project?: ProjectId | null) =>
  infiniteQueryOptions({
    queryKey: [
      'notes',
      'pages',
      project === undefined ? 'all' : project === null ? 'projectless' : project.toString()
    ],
    initialPageParam: undefined as NoteCursor,
    queryFn: ({ pageParam, signal }) =>
      request((client) => client['notes.notes']({ limit: 30, project, before: pageParam }), signal),
    getNextPageParam: (page) => page.next ?? undefined
  });

export const noteOptions = (id: NoteId) =>
  queryOptions({
    queryKey: [...noteKey(id), 'detail'],
    queryFn: ({ signal }) => request((client) => client['notes.note']({ id }), signal),
    refetchInterval: (query) => (query.state.data?.titleSource === 'provisional' ? 3000 : false)
  });

/** Keep the unselected notes index inert without inventing a note identity. */
export const selectedNoteOptions = (id?: NoteId) => {
  const selected = id === undefined ? undefined : noteOptions(id);

  return queryOptions({
    queryKey: selected?.queryKey ?? ['note-workspace', 'unselected', 'detail'],
    queryFn: selected?.queryFn ?? skipToken
  });
};

export const threadOptions = (id: NoteId) =>
  infiniteQueryOptions({
    queryKey: [...noteKey(id), 'thread'],
    initialPageParam: undefined as MessageId | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(
        (client) => client['notes.thread']({ noteId: id, before: pageParam, limit: 30 }),
        signal
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    refetchInterval: 3000
  });

export const selectionOptions = (id: NoteId) =>
  queryOptions({
    queryKey: [...noteKey(id), 'selection'],
    queryFn: ({ signal }) =>
      request((client) => client['notes.noteSelection']({ noteId: id }), signal)
  });

export const provenanceOptions = (noteId: NoteId, messageId: MessageId, versionId: VersionId) =>
  queryOptions({
    queryKey: [...noteKey(noteId), 'provenance', String(messageId), String(versionId)],
    queryFn: ({ signal }) =>
      request((client) => client['notes.replyVersion']({ noteId, messageId, versionId }), signal)
  });

export const contextOptions = (requestId: string) =>
  queryOptions({
    queryKey: ['note-context', requestId],
    queryFn: ({ signal }) =>
      request((client) => client['notes.inspectNoteContext']({ requestId }), signal)
  });

export const generationOptions = (requestId: string) =>
  queryOptions({
    queryKey: ['note-generation', requestId],
    queryFn: ({ signal }) => request((client) => client['pages.transform']({ requestId }), signal),
    refetchInterval: (query) =>
      query.state.data?.resultVersionId || query.state.data?.cancelled ? false : 3000
  });

export const executionOptions = (requestId: string, eventId?: string) =>
  queryOptions({
    queryKey: ['note-execution', requestId, eventId],
    queryFn: ({ signal }) =>
      request(
        (client) =>
          client['workflows.executions']({ correlationId: requestId, eventId, limit: 30 }),
        signal
      ),
    refetchInterval: 3000
  });

export const deletionAttemptOptions = (id: NoteId) =>
  queryOptions({
    queryKey: [...noteKey(id), 'deletion-attempt'],
    queryFn: () => false,
    initialData: false,
    staleTime: Infinity,
    gcTime: Infinity
  });

export const deletionOptions = (id: NoteId, enabled: boolean) =>
  queryOptions({
    queryKey: [...noteKey(id), 'deletion'],
    queryFn: async ({ signal }) => {
      try {
        return await request((client) => client['notes.noteDeletion']({ id }), signal);
      } catch (error) {
        if (toStudyError(error).kind === 'not_found') return null;

        throw error;
      }
    },
    enabled,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 3000 : false)
  });

export const ask = (input: AskInput) => request((client) => client['notes.ask'](input));

export const saveNote = (noteId: NoteId, text: string, sourceIds?: readonly SourceId[]) =>
  request((client) =>
    client['notes.postMessage']({ noteId, text, sourceIds, requestReply: false })
  );

export const captureContext = (input: typeof captureNoteContextSchema.Type) =>
  request((client) => client['notes.captureNoteContext'](input));

export const transformPage = (input: TransformInput) =>
  request((client) => client['pages.requestTransform'](input));

export const cancelGeneration = (requestId: string) =>
  request((client) => client['pages.cancelTransform']({ requestId }));

export const retryGeneration = (requestId: string, retryId: string) =>
  request((client) => client['pages.retryTransform']({ requestId, retryId }));

export const deleteNote = (id: NoteId) => request((client) => client['notes.deleteNote']({ id }));

export const retryDeletion = (id: NoteId) =>
  request((client) => client['notes.retryNoteDeletion']({ id }));

export const noteMaterialSearchOptions = (query: string) =>
  queryOptions({
    queryKey: ['note-material-search', query],
    queryFn: ({ signal }) =>
      request((client) => client['system.materialSearch']({ query, limit: 30 }), signal),
    enabled: query.trim().length > 0
  });

export const citationsOptions = (noteId: NoteId, messageId: MessageId, versionId?: VersionId) =>
  queryOptions({
    enabled: versionId !== undefined,
    queryKey: [
      ...noteKey(noteId),
      'citations',
      String(messageId),
      versionId ? String(versionId) : null
    ],
    queryFn: ({ signal }) =>
      request(
        (client) =>
          client['notes.messageVersionCitations']({
            noteId,
            messageId,
            versionId: versionId!
          }),
        signal
      )
  });

export const noteGenerationsOptions = (noteId: NoteId) =>
  infiniteQueryOptions({
    queryKey: [...noteKey(noteId), 'generations'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(
        (client) => client['notes.noteGenerations']({ noteId, limit: 30, before: pageParam }),
        signal
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    refetchInterval: 3000
  });

export const uploadSource = (file: File) =>
  file.arrayBuffer().then((bytes) =>
    request((client) =>
      client['sources.createSource']({
        name: file.name,
        bytes: new Uint8Array(bytes),
        projectId: null
      })
    )
  );

export const editNote = (input: typeof editMessageInputSchema.Type) =>
  request((client) => client['notes.editMessage'](input));

export const activateVersion = (input: typeof setActiveVersionInputSchema.Type) =>
  request((client) => client['notes.setActiveVersion'](input));

export const rewriteNote = (input: typeof rewriteMessageInputSchema.Type) =>
  request((client) => client['notes.rewriteMessage'](input));

export const reanswerNote = (messageId: MessageId) =>
  request((client) => client['notes.reanswer']({ messageId }));

/** Shares the exact deletion request while leaving attempt ownership in its mounted caller. */

export const deleteNoteMutationOptions = (id: NoteId) =>
  mutationOptions({ mutationFn: () => deleteNote(id), retry: false });

/** Retries the existing cleanup operation rather than creating another deletion intent. */

export const retryNoteDeletionMutationOptions = (id: NoteId) =>
  mutationOptions({ mutationFn: () => retryDeletion(id), retry: false });

/** Give each explicit suggestion attempt its own durable intent without automatic retries. */
export const transformSuggestionMutationOptions = (
  input: Omit<typeof transformSuggestionInputSchema.Type, 'intentKey'>
) =>
  mutationOptions({
    retry: false,
    mutationFn: () =>
      request((client) =>
        client['notes.suggestTransformField']({ ...input, intentKey: crypto.randomUUID() })
      )
  });
