import type {
  sessionSelectionSchema,
  captureSessionContextSchema,
  updateSessionSelectionSchema
} from '@study/contracts/conversations/context';
import type { askInputSchema } from '@study/contracts/conversations/schemas';
import type { SessionId, MessageId, VersionId, ProjectId } from '@study/contracts/ids';
import type { requestDocumentTransformInputSchema } from '@study/contracts/materials/rpc';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import type { StudyClient } from '../../lib/study-client/client';
import { request } from '../../lib/study-client/request';

export type Selection = typeof sessionSelectionSchema.Type;
export type AskInput = typeof askInputSchema.Type;
export type TransformInput = typeof requestDocumentTransformInputSchema.Type;
type SessionCursor = Parameters<StudyClient['conversations.sessions']>[0]['before'];
export const sessionKey = (id: SessionId) => ['session-workspace', String(id)] as const;

export const sessionPagesOptions = (project?: ProjectId | null) =>
  infiniteQueryOptions({
    queryKey: [
      'sessions',
      'pages',
      project === undefined ? 'all' : project === null ? 'projectless' : project.toString()
    ],
    initialPageParam: undefined as SessionCursor,
    queryFn: ({ pageParam, signal }) =>
      request(
        (client) => client['conversations.sessions']({ limit: 30, project, before: pageParam }),
        signal
      ),
    getNextPageParam: (page) => page.next ?? undefined
  });
export const sessionOptions = (id: SessionId) =>
  queryOptions({
    queryKey: [...sessionKey(id), 'detail'],
    queryFn: ({ signal }) => request((client) => client['conversations.session']({ id }), signal)
  });
export const threadOptions = (id: SessionId) =>
  infiniteQueryOptions({
    queryKey: [...sessionKey(id), 'thread'],
    initialPageParam: undefined as MessageId | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(
        (client) => client['conversations.thread']({ sessionId: id, before: pageParam, limit: 30 }),
        signal
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    refetchInterval: 3000
  });
export const selectionOptions = (id: SessionId) =>
  queryOptions({
    queryKey: [...sessionKey(id), 'selection'],
    queryFn: ({ signal }) =>
      request((client) => client['conversations.sessionSelection']({ sessionId: id }), signal)
  });
export const provenanceOptions = (
  sessionId: SessionId,
  messageId: MessageId,
  versionId: VersionId
) =>
  queryOptions({
    queryKey: [...sessionKey(sessionId), 'provenance', String(messageId), String(versionId)],
    queryFn: ({ signal }) =>
      request(
        (client) => client['conversations.replyVersion']({ sessionId, messageId, versionId }),
        signal
      )
  });
export const contextOptions = (requestId: string) =>
  queryOptions({
    queryKey: ['session-context', requestId],
    queryFn: ({ signal }) =>
      request((client) => client['conversations.inspectSessionContext']({ requestId }), signal)
  });
export const generationOptions = (requestId: string) =>
  queryOptions({
    queryKey: ['session-generation', requestId],
    queryFn: ({ signal }) =>
      request((client) => client['materials.materialGeneration']({ requestId }), signal),
    refetchInterval: (query) =>
      query.state.data?.resultVersionId || query.state.data?.cancelled ? false : 3000
  });
export const executionOptions = (requestId: string, eventId?: string) =>
  queryOptions({
    queryKey: ['session-execution', requestId, eventId],
    queryFn: ({ signal }) =>
      request(
        (client) =>
          client['workflows.executions']({ correlationId: requestId, eventId, limit: 30 }),
        signal
      ),
    refetchInterval: 3000
  });
export const deletionOptions = (id: SessionId, enabled: boolean) =>
  queryOptions({
    queryKey: [...sessionKey(id), 'deletion'],
    queryFn: ({ signal }) =>
      request((client) => client['conversations.sessionDeletion']({ id }), signal),
    enabled,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 3000 : false)
  });
export const createSession = () =>
  request((client) => client['conversations.createUntitledSession']({}));
export const ask = (input: AskInput) => request((client) => client['conversations.ask'](input));
export const saveNote = (
  sessionId: SessionId,
  text: string,
  sourceIds?: readonly import('@study/contracts/ids').SourceId[]
) =>
  request((client) =>
    client['conversations.postMessage']({ sessionId, text, sourceIds, requestReply: false })
  );
export const updateSelection = (input: typeof updateSessionSelectionSchema.Type) =>
  request((client) => client['conversations.updateSessionSelection'](input));
export const captureContext = (input: typeof captureSessionContextSchema.Type) =>
  request((client) => client['conversations.captureSessionContext'](input));
export const transformDocument = (input: TransformInput) =>
  request((client) => client['materials.requestDocumentTransform'](input));
export const cancelGeneration = (requestId: string) =>
  request((client) => client['materials.cancelMaterialGeneration']({ requestId }));
export const retryGeneration = (requestId: string, retryId: string) =>
  request((client) => client['materials.retryMaterialGeneration']({ requestId, retryId }));
export const deleteSession = (id: SessionId) =>
  request((client) => client['conversations.deleteSession']({ id }));
export const retryDeletion = (id: SessionId) =>
  request((client) => client['conversations.retrySessionDeletion']({ id }));

export const exactDocumentOptions = (id: import('@study/contracts/ids').MaterialVersionId) =>
  queryOptions({
    queryKey: ['session-document', String(id)],
    queryFn: ({ signal }) =>
      request((client) => client['materials.materialVersionDocument']({ id }), signal)
  });
export const materialSearchOptions = (query: string) =>
  queryOptions({
    queryKey: ['session-material-search', query],
    queryFn: ({ signal }) =>
      request((client) => client['system.materialSearch']({ query, limit: 30 }), signal),
    enabled: query.trim().length > 0
  });

export const citationsOptions = (
  sessionId: SessionId,
  messageId: MessageId,
  versionId?: VersionId
) =>
  queryOptions({
    enabled: versionId !== undefined,
    queryKey: [
      ...sessionKey(sessionId),
      'citations',
      String(messageId),
      versionId ? String(versionId) : null
    ],
    queryFn: ({ signal }) =>
      request(
        (client) =>
          client['conversations.messageVersionCitations']({
            sessionId,
            messageId,
            versionId: versionId!
          }),
        signal
      )
  });

export const sessionGenerationsOptions = (sessionId: SessionId) =>
  infiniteQueryOptions({
    queryKey: [...sessionKey(sessionId), 'generations'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(
        (client) =>
          client['conversations.sessionGenerations']({ sessionId, limit: 30, before: pageParam }),
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
export const editNote = (input: Parameters<StudyClient['conversations.editMessage']>[0]) =>
  request((client) => client['conversations.editMessage'](input));
export const activateVersion = (
  input: Parameters<StudyClient['conversations.setActiveVersion']>[0]
) => request((client) => client['conversations.setActiveVersion'](input));
export const rewriteNote = (input: Parameters<StudyClient['conversations.rewriteMessage']>[0]) =>
  request((client) => client['conversations.rewriteMessage'](input));
export const reanswerNote = (messageId: MessageId) =>
  request((client) => client['conversations.reanswer']({ messageId }));
