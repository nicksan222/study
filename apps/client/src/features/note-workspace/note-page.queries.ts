import { RegistryContext, useAtomInitialValues, useAtomValue } from '@effect/atom-react';
import { StudyError, plainBlock, documentSchema } from '@study/contracts';
import type {
  PageId,
  PageVersionId,
  ProjectId,
  NoteId,
  createSchema,
  saveSchema,
  Page
} from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Schema } from 'effect';
import { Atom } from 'effect/reactivity';
import type { AtomRegistry } from 'effect/reactivity';
import { useContext, useEffect, useMemo } from 'react';

import { useCursorRecovery, useCursorWindow } from '#client/lib/cursor-window.tsx';
import { repeatRequest } from '#client/lib/study-client/repeat-request.ts';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { blankDocument } from '../document-editing';

type Document = typeof documentSchema.Type;

type CreationInput = typeof createSchema.Type;

type SaveInput = typeof saveSchema.Type;

const equalDocument = Schema.toEquivalence(documentSchema);

export function useLinkedPages(noteId: NoteId) {
  const pagination = useCursorWindow<PageId>(String(noteId));
  const query = rpc.pages.list.useQuery({
    noteId,
    cursor: pagination.cursor,
    limit: pagination.limit,
    archived: false
  });

  useCursorRecovery(pagination, query.error);

  return { ...query, pagination };
}

type Creation = { pending: boolean; input?: CreationInput; error?: unknown };

const initialCreation: Creation = { pending: false };

const creations = Atom.family((_owner: string) => Atom.make(initialCreation).pipe(Atom.keepAlive));

/** An uncertain creation retains its exact key and payload until the receipt is recovered. */
type PageOwner = { kind: 'note'; noteId: NoteId } | { kind: 'project'; projectId?: ProjectId };

export function useNotePageCreation(noteId: NoteId) {
  return useBlankPageCreation({ kind: 'note', noteId });
}

export function useBlankPageCreation(owner: PageOwner) {
  const registry = useContext(RegistryContext);
  const atom = creations(
    owner.kind === 'note' ? `note:${owner.noteId}` : `project:${owner.projectId ?? 'global'}`
  );
  const creation = useAtomValue(atom);

  async function submit(input: CreationInput) {
    const current = registry.get(atom);

    if (current?.pending) return undefined;

    registry.set(atom, { pending: true, input });

    try {
      const createdPage = await rpc.pages.create.call(input);

      registry.set(atom, initialCreation);

      return createdPage;
    } catch (error) {
      registry.set(atom, { pending: false, input, error });

      return undefined;
    }
  }

  return {
    pending: creation.pending,
    error: creation.error,
    create: (title: string) => {
      const pending = registry.get(atom);

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
      const input = registry.get(atom)?.input;

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

const drafts = Atom.family((_id: PageId) =>
  Atom.make<Draft | undefined>(undefined).pipe(Atom.keepAlive)
);

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

/** Pages owns versioned content; local atoms hold unsaved edits and retry receipts. */
export function useNotePageAutosave(page: Page) {
  const { autosaveIntervalSeconds } = useWorkspacePreferences();
  const registry = useContext(RegistryContext);
  const initial = useMemo(() => initialDraft(page), [page]);
  const atom = drafts(page.id);

  useAtomInitialValues([[atom, registry.get(atom) ?? initial]]);
  const stored = useAtomValue(atom);
  const draft = stored ?? initial;

  const id = page.id;

  useEffect(() => {
    const stop = repeatRequest(() => persistPage(registry, id), autosaveIntervalSeconds * 1000);

    return () => {
      stop();
      void persistPage(registry, id);
    };
  }, [registry, id, autosaveIntervalSeconds]);
  useEffect(() => {
    registry.set(
      atom,
      ((current) =>
        current &&
        !current.pending &&
        !current.attempt &&
        equalDocument(current.document, current.saved) &&
        page.version !== null &&
        page.version.id > current.versionId
          ? initialDraft(page)
          : current)(registry.get(atom))
    );
  }, [registry, atom, page]);

  return {
    document: draft.document,
    pending: draft.pending,
    dirty: !equalDocument(draft.document, draft.saved),
    error: draft.error,
    conflict: draft.conflict,
    change: (document: Document) =>
      registry.set(atom, { ...(registry.get(atom) ?? initial), document }),
    save: () => persistPage(registry, id, true),
    acceptSavedVersion: () => {
      if (draft.conflict) registry.set(atom, initialDraft(draft.conflict));
    }
  };
}

function saveBlocked(draft: Draft, manual: boolean) {
  return draft.pending || (!manual && draft.error !== undefined) || draft.conflict !== undefined;
}

async function persistPage(
  registry: AtomRegistry.AtomRegistry,
  id: PageId,
  manual = false
): Promise<void> {
  const atom = drafts(id);
  const draft = registry.get(atom);

  if (!draft || saveBlocked(draft, manual)) return;

  if (!draft.attempt && equalDocument(draft.document, draft.saved)) return;

  const input = draft.attempt ?? {
    pageId: id,
    expectedVersionId: draft.versionId,
    key: crypto.randomUUID(),
    document: draft.document
  };
  const patch = (update: (current: Draft) => Draft) =>
    registry.set(atom, update(registry.get(atom) ?? draft));

  patch((current) => ({ ...current, pending: true, attempt: input, error: undefined }));

  try {
    const outcome = await rpc.pages.save.call(input);

    if (outcome.outcome === 'conflict') {
      const conflict = await rpc.pages.get.read({ id });

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
    await persistPage(registry, id);
  } catch (error) {
    patch((current) => ({ ...current, pending: false, error }));
  }
}
