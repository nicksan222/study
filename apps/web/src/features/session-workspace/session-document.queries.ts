import type { createSchema, saveSchema } from '@study/contracts/documents/editing';
import type { StudyDocument, StudyDocumentSummary } from '@study/contracts/documents/types';
import { StudyError } from '@study/contracts/errors';
import type {
  StudyDocumentId,
  StudyDocumentVersionId,
  ProjectId,
  SessionId
} from '@study/contracts/ids';
import { plainBlock } from '@study/contracts/sources/document';
import { documentSchema } from '@study/contracts/sources/schemas';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { Schema } from 'effect';
import { useEffect } from 'react';

import { invalidateDocuments } from '#web/lib/study-client/documents.queries.ts';
import { repeatRequest } from '#web/lib/study-client/repeat-request.ts';
import { request } from '#web/lib/study-client/request.ts';
import { useWorkspacePreferences } from '#web/lib/study-client/workspace-preferences.queries.ts';

import { blankDocument } from '../document-editing';

type Document = typeof documentSchema.Type;

type CreationInput = typeof createSchema.Type;

type SaveInput = typeof saveSchema.Type;

const equalDocument = Schema.toEquivalence(documentSchema);

export const sessionDocumentsOptions = (sessionId: SessionId) =>
  queryOptions({
    queryKey: ['documents', 'session', String(sessionId), 'documents'],
    queryFn: async ({ signal }) => {
      const items: StudyDocumentSummary[] = [];
      let cursor: StudyDocumentId | undefined;

      do {
        const page = await request(
          (rpc) => rpc['documents.documents']({ sessionId, limit: 100, cursor, archived: false }),
          signal
        );

        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);

      return { items, nextCursor: null };
    }
  });

export const sessionDocumentOptions = (id: StudyDocumentId) =>
  queryOptions({
    queryKey: ['documents', 'detail', String(id)],
    queryFn: ({ signal }) => request((rpc) => rpc['documents.document']({ id }), signal)
  });

type Creation = { pending: boolean; input?: CreationInput; error?: unknown };

/** An uncertain creation retains its exact key and payload until the receipt is recovered. */
type DocumentOwner =
  | { kind: 'session'; sessionId: SessionId }
  | { kind: 'project'; projectId?: ProjectId };

export function useSessionDocumentCreation(sessionId: SessionId) {
  return useBlankDocumentCreation({ kind: 'session', sessionId });
}

export function useBlankDocumentCreation(owner: DocumentOwner) {
  const cache = useQueryClient();
  const key =
    owner.kind === 'session'
      ? ['session-drafts', String(owner.sessionId), 'document-creation']
      : ['document-drafts', owner.projectId?.toString() ?? 'global', 'creation'];
  const initial: Creation = { pending: false };
  const state = useQuery({
    queryKey: key,
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
    gcTime: Infinity
  });

  async function submit(input: CreationInput) {
    const current = cache.getQueryData<Creation>(key);

    if (current?.pending) return undefined;

    cache.setQueryData<Creation>(key, { pending: true, input });

    try {
      const document = await request((rpc) => rpc['documents.create'](input));

      cache.setQueryData(key, initial);

      if (owner.kind === 'session') {
        const listKey = sessionDocumentsOptions(owner.sessionId).queryKey;

        await cache.cancelQueries({ queryKey: listKey, exact: true });
        cache.setQueryData<{ items: StudyDocumentSummary[]; nextCursor: null }>(
          listKey,
          (page) => ({
            items: [document, ...(page?.items ?? []).filter((item) => item.id !== document.id)],
            nextCursor: null
          })
        );
      }

      cache.setQueryData(sessionDocumentOptions(document.id).queryKey, document);
      void invalidateDocuments(cache);

      return document;
    } catch (error) {
      cache.setQueryData<Creation>(key, { pending: false, input, error });

      return undefined;
    }
  }

  return {
    pending: state.data.pending,
    error: state.data.error,
    create: (title: string) => {
      const pending = cache.getQueryData<Creation>(key);

      return submit(
        pending?.input ?? {
          ...(owner.kind === 'session'
            ? { sessionId: owner.sessionId }
            : { projectId: owner.projectId }),
          title,
          createKey: crypto.randomUUID(),
          document: {
            ...blankDocument(),
            blocks: [plainBlock('paragraph', '', { type: 'authored' })]
          },
          inputs: [],
          citations: []
        }
      );
    },
    retry: () => {
      const input = cache.getQueryData<Creation>(key)?.input;

      return input ? submit(input) : Promise.resolve(undefined);
    }
  };
}

type Draft = {
  document: Document;
  saved: Document;
  versionId: StudyDocumentVersionId;
  pending: boolean;
  attempt?: SaveInput;
  error?: unknown;
  conflict?: StudyDocument;
};

const draftKey = (id: StudyDocumentId) => ['session-document-drafts', String(id)] as const;

function initialDraft(document: StudyDocument): Draft {
  if (!document.version)
    throw new StudyError('invalid_input', 'Only authored documents can be edited directly');

  return {
    document: document.version.document,
    saved: document.version.document,
    versionId: document.version.id,
    pending: false
  };
}

/** Documents owns versioned content; the cache holds only unsaved edits and retry receipts. */
export function useSessionDocumentAutosave(document: StudyDocument) {
  const { autosaveIntervalSeconds } = useWorkspacePreferences();
  const cache = useQueryClient();
  const initial = initialDraft(document);
  const key = draftKey(document.id);
  const state = useQuery({
    queryKey: key,
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const draft = state.data;
  const id = document.id;

  useEffect(() => {
    const stop = repeatRequest(() => persistDocument(cache, id), autosaveIntervalSeconds * 1000);

    return () => {
      stop();
      void persistDocument(cache, id);
    };
  }, [cache, id, autosaveIntervalSeconds]);
  useEffect(() => {
    cache.setQueryData<Draft>(draftKey(document.id), (current) =>
      current &&
      !current.pending &&
      !current.attempt &&
      equalDocument(current.document, current.saved) &&
      document.version !== null &&
      document.version.id > current.versionId
        ? initialDraft(document)
        : current
    );
  }, [cache, document]);

  return {
    document: draft.document,
    pending: draft.pending,
    dirty: !equalDocument(draft.document, draft.saved),
    error: draft.error,
    conflict: draft.conflict,
    change: (document: Document) =>
      cache.setQueryData<Draft>(key, (current) => ({ ...(current ?? initial), document })),
    save: () => persistDocument(cache, id, true),
    acceptSavedVersion: () => {
      if (draft.conflict) cache.setQueryData(key, initialDraft(draft.conflict));
    }
  };
}

function saveBlocked(draft: Draft, manual: boolean) {
  return draft.pending || (!manual && draft.error !== undefined) || draft.conflict !== undefined;
}

async function persistDocument(
  cache: QueryClient,
  id: StudyDocumentId,
  manual = false
): Promise<void> {
  const key = draftKey(id);
  const draft = cache.getQueryData<Draft>(key);

  if (!draft || saveBlocked(draft, manual)) return;

  if (!draft.attempt && equalDocument(draft.document, draft.saved)) return;

  const input = draft.attempt ?? {
    documentId: id,
    expectedVersionId: draft.versionId,
    key: crypto.randomUUID(),
    document: draft.document
  };
  const patch = (update: (current: Draft) => Draft) =>
    cache.setQueryData<Draft>(key, (current) => update(current ?? draft));

  patch((current) => ({ ...current, pending: true, attempt: input, error: undefined }));

  try {
    const outcome = await request((rpc) => rpc['documents.save'](input));

    if (outcome.outcome === 'conflict') {
      const conflict = await request((rpc) => rpc['documents.document']({ id }));

      patch((current) => ({
        ...current,
        pending: false,
        conflict,
        error: new StudyError('invalid_input', 'Document changed before save')
      }));

      return;
    }

    patch((current) => ({
      ...current,
      saved: input.document,
      versionId: outcome.submittedVersionId,
      pending: false,
      attempt: undefined,
      error: undefined
    }));
    void invalidateDocuments(cache);
    await persistDocument(cache, id);
  } catch (error) {
    patch((current) => ({ ...current, pending: false, error }));
  }
}
