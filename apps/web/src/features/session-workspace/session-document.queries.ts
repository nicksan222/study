import { StudyError } from '@study/contracts/errors';
import type { MaterialId, MaterialVersionId, SessionId } from '@study/contracts/ids';
import type {
  createManualDocumentSchema,
  saveDocumentInputSchema
} from '@study/contracts/materials/editing';
import type { MaterialDetailDto, MaterialSummaryDto } from '@study/contracts/materials/schemas';
import { materialDocumentSchema } from '@study/contracts/materials/schemas';
import { plainBlock } from '@study/contracts/sources/document';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { Schema } from 'effect';
import { useEffect } from 'react';

import { repeatRequest } from '../../lib/study-client/repeat-request';
import { request } from '../../lib/study-client/request';
import { authoredCopy, blankDocument } from '../document-editing';

type Document = typeof materialDocumentSchema.Type;

type CreationInput = typeof createManualDocumentSchema.Type;

type SaveInput = typeof saveDocumentInputSchema.Type;

const equalDocument = Schema.toEquivalence(materialDocumentSchema);

export const sessionDocumentsOptions = (sessionId: SessionId) =>
  queryOptions({
    queryKey: ['materials', 'session', String(sessionId), 'documents'],
    queryFn: async ({ signal }) => {
      const items: MaterialSummaryDto[] = [];
      let cursor: MaterialId | undefined;

      do {
        const page = await request(
          (rpc) => rpc['materials.materials']({ sessionId, limit: 100, cursor, archived: false }),
          signal
        );

        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);

      return { items, nextCursor: null };
    }
  });

export const sessionDocumentOptions = (id: MaterialId) =>
  queryOptions({
    queryKey: ['materials', 'detail', String(id)],
    queryFn: ({ signal }) => request((rpc) => rpc['materials.material']({ id }), signal),
    refetchInterval: (query) =>
      query.state.data?.importProcessing?.status === 'pending' ? 3000 : false
  });

type Creation = { pending: boolean; input?: CreationInput; error?: unknown };

/** An uncertain creation retains its exact key and payload until the receipt is recovered. */
export function useSessionDocumentCreation(sessionId: SessionId) {
  const cache = useQueryClient();
  const key = ['session-drafts', String(sessionId), 'document-creation'];
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
      const material = await request((rpc) => rpc['materials.createManualDocument'](input));

      cache.setQueryData(key, initial);
      const listKey = sessionDocumentsOptions(sessionId).queryKey;

      await cache.cancelQueries({ queryKey: listKey, exact: true });
      cache.setQueryData<{ items: MaterialSummaryDto[]; nextCursor: null }>(listKey, (page) => ({
        items: [material, ...(page?.items ?? []).filter((item) => item.id !== material.id)],
        nextCursor: null
      }));
      cache.setQueryData(sessionDocumentOptions(material.id).queryKey, material);
      void cache.invalidateQueries({ queryKey: ['materials'] });

      return material;
    } catch (error) {
      cache.setQueryData<Creation>(key, { pending: false, input, error });

      return undefined;
    }
  }

  return {
    pending: state.data.pending,
    error: state.data.error,
    create: (title: string, source?: { document: Document; inputVersionId: MaterialVersionId }) => {
      const pending = cache.getQueryData<Creation>(key);

      return submit(
        pending?.input ?? {
          sessionId,
          title,
          createKey: crypto.randomUUID(),
          document: source
            ? authoredCopy(source.document)
            : { ...blankDocument(), blocks: [plainBlock('paragraph', '', { type: 'authored' })] },
          inputVersionId: source?.inputVersionId
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
  versionId: MaterialVersionId;
  pending: boolean;
  attempt?: SaveInput;
  error?: unknown;
  conflict?: MaterialDetailDto;
};

const draftKey = (id: MaterialId) => ['session-document-drafts', String(id)] as const;

function initialDraft(material: MaterialDetailDto): Draft {
  if (material.version.content.kind !== 'document')
    throw new StudyError('invalid_input', 'Only authored documents can be edited directly');

  return {
    document: material.version.content,
    saved: material.version.content,
    versionId: material.version.id,
    pending: false
  };
}

/** The material owns versioned content; the cache holds only unsaved edits and retry receipts. */
export function useSessionDocumentAutosave(material: MaterialDetailDto) {
  const cache = useQueryClient();
  const initial = initialDraft(material);
  const key = draftKey(material.id);
  const state = useQuery({
    queryKey: key,
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const draft = state.data;
  const id = material.id;

  useEffect(() => {
    const stop = repeatRequest(() => persistDocument(cache, id), '3 seconds');

    return () => {
      stop();
      void persistDocument(cache, id);
    };
  }, [cache, id]);
  useEffect(() => {
    cache.setQueryData<Draft>(draftKey(material.id), (current) =>
      current &&
      !current.pending &&
      !current.attempt &&
      equalDocument(current.document, current.saved) &&
      material.version.id > current.versionId
        ? initialDraft(material)
        : current
    );
  }, [cache, material]);

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

async function persistDocument(cache: QueryClient, id: MaterialId, manual = false): Promise<void> {
  const key = draftKey(id);
  const draft = cache.getQueryData<Draft>(key);

  if (!draft || saveBlocked(draft, manual)) return;

  if (!draft.attempt && equalDocument(draft.document, draft.saved)) return;

  const input = draft.attempt ?? {
    materialId: id,
    expectedVersionId: draft.versionId,
    saveKey: crypto.randomUUID(),
    document: draft.document
  };
  const patch = (update: (current: Draft) => Draft) =>
    cache.setQueryData<Draft>(key, (current) => update(current ?? draft));

  patch((current) => ({ ...current, pending: true, attempt: input, error: undefined }));

  try {
    const outcome = await request((rpc) => rpc['materials.saveDocument'](input));

    if (outcome.outcome === 'conflict') {
      const conflict = await request((rpc) => rpc['materials.material']({ id }));

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
    void cache.invalidateQueries({ queryKey: ['materials'] });
    await persistDocument(cache, id);
  } catch (error) {
    patch((current) => ({ ...current, pending: false, error }));
  }
}
