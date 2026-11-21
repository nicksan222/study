import { RegistryContext, useAtomValue } from '@effect/atom-react';
import { StudyError } from '@study/contracts';
import type { NoteId, VersionId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Atom } from 'effect/reactivity';
import type { AtomRegistry } from 'effect/reactivity';
import { useContext, useEffect, useState } from 'react';

import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { deletionAttempt } from './deletion';

type SavedBody = { text: string; versionId: VersionId | null };

type BodyDraft = {
  saved: SavedBody;
  text: string;
  pending?: boolean;
  error?: unknown;
  conflict?: SavedBody;
  recoveryBase?: string;
};

const drafts = Atom.family((_id: NoteId) =>
  Atom.make<BodyDraft | undefined>(undefined).pipe(Atom.keepAlive)
);

export const starterTransfer = Atom.family((_id: NoteId) =>
  Atom.make<{ text: string; submitted: string; focus: boolean } | undefined>(undefined).pipe(
    Atom.keepAlive
  )
);

function storageKey(id: NoteId) {
  return `study:note-body:${id}`;
}

function readDraft(id: NoteId): { text: string; base: string } | undefined {
  try {
    const raw = window.sessionStorage.getItem(storageKey(id));

    if (!raw) return undefined;

    const value: unknown = JSON.parse(raw);

    if (
      typeof value === 'object' &&
      value !== null &&
      'text' in value &&
      typeof value.text === 'string' &&
      'base' in value &&
      typeof value.base === 'string'
    )
      return { text: value.text, base: value.base };
  } catch {
    // In-memory drafts still work when browser storage is unavailable.
  }
}

function rememberDraft(id: NoteId, draft: BodyDraft) {
  try {
    if (draft.text === draft.saved.text) window.sessionStorage.removeItem(storageKey(id));
    else
      window.sessionStorage.setItem(
        storageKey(id),
        JSON.stringify({
          text: draft.text,
          base: draft.recoveryBase ?? String(draft.saved.versionId)
        })
      );
  } catch {
    // In-memory drafts still work when browser storage is unavailable.
  }
}

function updateBody(registry: AtomRegistry.AtomRegistry, id: NoteId, draft: BodyDraft) {
  registry.set(drafts(id), draft);
  rememberDraft(id, draft);
}

function initialDraft(
  registry: AtomRegistry.AtomRegistry,
  id: NoteId,
  saved: SavedBody
): BodyDraft {
  const transfer = registry.get(starterTransfer(id));

  if (transfer)
    return { saved, text: transfer.text === transfer.submitted ? saved.text : transfer.text };

  const stored = readDraft(id);

  if (!stored || stored.text === saved.text) return { saved, text: saved.text };

  if (stored.base === String(saved.versionId)) return { saved, text: stored.text };

  return {
    saved,
    text: stored.text,
    error: new StudyError('invalid_input', 'Notebook changed while a local draft was present'),
    conflict: saved,
    recoveryBase: stored.base
  };
}

function syncBody(
  registry: AtomRegistry.AtomRegistry,
  id: NoteId,
  saved: SavedBody,
  initial: BodyDraft
) {
  const old = registry.get(drafts(id));

  if (!old) {
    updateBody(registry, id, initial);
  } else if (
    !old.pending &&
    !old.error &&
    old.text === old.saved.text &&
    saved.versionId !== null &&
    (old.saved.versionId === null || saved.versionId > old.saved.versionId)
  ) {
    updateBody(registry, id, { saved, text: saved.text });
  }
}

function pendingBodyWrite(registry: AtomRegistry.AtomRegistry, id: NoteId, retry: boolean) {
  const draft = registry.get(drafts(id));

  if (registry.get(deletionAttempt(id)).started || !draft || draft.pending || draft.conflict)
    return undefined;

  return (retry || !draft.error) && draft.text !== draft.saved.text ? draft : undefined;
}

async function writeBody(id: NoteId, text: string, versionId: VersionId | null) {
  try {
    return {
      saved: await rpc.notes.saveBody.call({ noteId: id, text, expectedVersionId: versionId })
    };
  } catch (error) {
    const current = await readBodyAfterFailure(id);

    if (current?.versionId === versionId || !current) return { error };

    if (current.text === text) return { saved: current };

    return { error, conflict: current };
  }
}

async function readBodyAfterFailure(id: NoteId) {
  try {
    return await rpc.notes.body.read({ noteId: id });
  } catch {
    // A detached transport or failed receipt read leaves the draft available for retry.
    return undefined;
  }
}

async function persistBody(registry: AtomRegistry.AtomRegistry, id: NoteId, retry = false) {
  const draft = pendingBodyWrite(registry, id, retry);

  if (!draft) return;

  const patch = (fields: Partial<BodyDraft>) =>
    updateBody(registry, id, { ...(registry.get(drafts(id)) ?? draft), ...fields });

  patch({ pending: true, error: undefined });

  const result = await writeBody(id, draft.text, draft.saved.versionId);

  if (result.saved) {
    patch({ saved: result.saved, pending: false });
    await persistBody(registry, id);
  } else {
    patch({ error: result.error, conflict: result.conflict, pending: false });
  }
}

/** Keeps one in-flight write per note, even while navigating between notebooks. */
export function useBodyAutosave(id: NoteId, saved: SavedBody) {
  const registry = useContext(RegistryContext);
  const { autosaveIntervalSeconds } = useWorkspacePreferences();
  const atom = drafts(id);
  const [focus] = useState(() => registry.get(starterTransfer(id))?.focus ?? false);
  const [initial] = useState(() => initialDraft(registry, id, saved));
  const stored = useAtomValue(atom);
  const draft = stored ?? initial;

  useEffect(() => {
    syncBody(registry, id, saved, initial);
    registry.set(starterTransfer(id), undefined);
  }, [registry, id, saved, initial]);
  useEffect(() => {
    if (draft.text === draft.saved.text || draft.error) return;

    const timer = window.setTimeout(
      () => void persistBody(registry, id),
      autosaveIntervalSeconds * 1000
    );

    return () => window.clearTimeout(timer);
  }, [registry, id, autosaveIntervalSeconds, draft.text, draft.saved.text, draft.error]);
  useEffect(() => {
    const flush = () => void persistBody(registry, id);

    window.addEventListener('pagehide', flush);

    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [registry, id]);

  return {
    draft,
    focus,
    setText: (text: string) => updateBody(registry, id, { ...(registry.get(atom) ?? draft), text }),
    retry: () => void persistBody(registry, id, true),
    acceptSaved: () => {
      if (draft.conflict)
        updateBody(registry, id, { saved: draft.conflict, text: draft.conflict.text });
    }
  };
}
