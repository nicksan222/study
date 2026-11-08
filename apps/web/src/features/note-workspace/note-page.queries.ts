import { StudyError } from '@study/contracts/errors';
import type { PageId, PageVersionId, ProjectId, NoteId } from '@study/contracts/ids';
import type { createSchema, saveSchema } from '@study/contracts/pages/editing';
import type { Page, PageSummary } from '@study/contracts/pages/types';
import { plainBlock } from '@study/contracts/sources/document';
import { documentSchema } from '@study/contracts/sources/schemas';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { Schema } from 'effect';
import { useEffect } from 'react';

import { invalidatePages } from '#web/lib/study-client/pages.queries.ts';
import { repeatRequest } from '#web/lib/study-client/repeat-request.ts';
import { request } from '#web/lib/study-client/request.ts';
import { useWorkspacePreferences } from '#web/lib/study-client/workspace-preferences.queries.ts';

import { blankDocument } from '../document-editing';

type Document = typeof documentSchema.Type;

type CreationInput = typeof createSchema.Type;

type SaveInput = typeof saveSchema.Type;

const equalDocument = Schema.toEquivalence(documentSchema);

export const linkedPagesOptions = (noteId: NoteId) =>
  queryOptions({
    queryKey: ['pages', 'note', String(noteId), 'pages'],
    queryFn: async ({ signal }) => {
      const items: PageSummary[] = [];
      let cursor: PageId | undefined;

      do {
        const page = await request(
          (rpc) => rpc['pages.pages']({ noteId, limit: 100, cursor, archived: false }),
          signal
        );

        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);

      return { items, nextCursor: null };
    }
  });

export const notePageOptions = (id: PageId) =>
  queryOptions({
    queryKey: ['pages', 'detail', String(id)],
    queryFn: ({ signal }) => request((rpc) => rpc['pages.page']({ id }), signal)
  });

type Creation = { pending: boolean; input?: CreationInput; error?: unknown };

/** An uncertain creation retains its exact key and payload until the receipt is recovered. */
type PageOwner = { kind: 'note'; noteId: NoteId } | { kind: 'project'; projectId?: ProjectId };

export function useNotePageCreation(noteId: NoteId) {
  return useBlankPageCreation({ kind: 'note', noteId });
}

export function useBlankPageCreation(owner: PageOwner) {
  const cache = useQueryClient();
  const key =
    owner.kind === 'note'
      ? ['note-drafts', String(owner.noteId), 'page-creation']
      : ['page-drafts', owner.projectId?.toString() ?? 'global', 'creation'];
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
      const createdPage = await request((rpc) => rpc['pages.create'](input));

      cache.setQueryData(key, initial);

      if (owner.kind === 'note') {
        const listKey = linkedPagesOptions(owner.noteId).queryKey;

        await cache.cancelQueries({ queryKey: listKey, exact: true });
        cache.setQueryData<{ items: PageSummary[]; nextCursor: null }>(listKey, (page) => ({
          items: [createdPage, ...(page?.items ?? []).filter((item) => item.id !== createdPage.id)],
          nextCursor: null
        }));
      }

      cache.setQueryData(notePageOptions(createdPage.id).queryKey, createdPage);
      void invalidatePages(cache);

      return createdPage;
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
          ...(owner.kind === 'note' ? { noteId: owner.noteId } : { projectId: owner.projectId }),
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
  versionId: PageVersionId;
  pending: boolean;
  attempt?: SaveInput;
  error?: unknown;
  conflict?: Page;
};

const draftKey = (id: PageId) => ['note-page-drafts', String(id)] as const;

function initialDraft(page: Page): Draft {
  if (!page.version)
    throw new StudyError('invalid_input', 'Only authored pages can be edited directly');

  return {
    document: page.version.document,
    saved: page.version.document,
    versionId: page.version.id,
    pending: false
  };
}

/** Pages owns versioned content; the cache holds only unsaved edits and retry receipts. */
export function useNotePageAutosave(page: Page) {
  const { autosaveIntervalSeconds } = useWorkspacePreferences();
  const cache = useQueryClient();
  const initial = initialDraft(page);
  const key = draftKey(page.id);
  const state = useQuery({
    queryKey: key,
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const draft = state.data;
  const id = page.id;

  useEffect(() => {
    const stop = repeatRequest(() => persistPage(cache, id), autosaveIntervalSeconds * 1000);

    return () => {
      stop();
      void persistPage(cache, id);
    };
  }, [cache, id, autosaveIntervalSeconds]);
  useEffect(() => {
    cache.setQueryData<Draft>(draftKey(page.id), (current) =>
      current &&
      !current.pending &&
      !current.attempt &&
      equalDocument(current.document, current.saved) &&
      page.version !== null &&
      page.version.id > current.versionId
        ? initialDraft(page)
        : current
    );
  }, [cache, page]);

  return {
    document: draft.document,
    pending: draft.pending,
    dirty: !equalDocument(draft.document, draft.saved),
    error: draft.error,
    conflict: draft.conflict,
    change: (document: Document) =>
      cache.setQueryData<Draft>(key, (current) => ({ ...(current ?? initial), document })),
    save: () => persistPage(cache, id, true),
    acceptSavedVersion: () => {
      if (draft.conflict) cache.setQueryData(key, initialDraft(draft.conflict));
    }
  };
}

function saveBlocked(draft: Draft, manual: boolean) {
  return draft.pending || (!manual && draft.error !== undefined) || draft.conflict !== undefined;
}

async function persistPage(cache: QueryClient, id: PageId, manual = false): Promise<void> {
  const key = draftKey(id);
  const draft = cache.getQueryData<Draft>(key);

  if (!draft || saveBlocked(draft, manual)) return;

  if (!draft.attempt && equalDocument(draft.document, draft.saved)) return;

  const input = draft.attempt ?? {
    pageId: id,
    expectedVersionId: draft.versionId,
    key: crypto.randomUUID(),
    document: draft.document
  };
  const patch = (update: (current: Draft) => Draft) =>
    cache.setQueryData<Draft>(key, (current) => update(current ?? draft));

  patch((current) => ({ ...current, pending: true, attempt: input, error: undefined }));

  try {
    const outcome = await request((rpc) => rpc['pages.save'](input));

    if (outcome.outcome === 'conflict') {
      const conflict = await request((rpc) => rpc['pages.page']({ id }));

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
    void invalidatePages(cache);
    await persistPage(cache, id);
  } catch (error) {
    patch((current) => ({ ...current, pending: false, error }));
  }
}
