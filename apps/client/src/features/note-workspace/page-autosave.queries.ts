import { RegistryContext, useAtomInitialValues, useAtomValue } from '@effect/atom-react';
import { StudyError } from '@study/contracts';
import type {
  NoteId,
  MessageId,
  VersionId,
  ChatMessage,
  postMessageInputSchema,
  editMessageInputSchema
} from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Atom } from 'effect/reactivity';
import type { AtomRegistry } from 'effect/reactivity';
import { useContext, useEffect, useMemo, useRef } from 'react';

import { toStudyError } from '#client/lib/study-client/errors.ts';
import { repeatRequest } from '#client/lib/study-client/repeat-request.ts';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

export type PageTarget =
  | { kind: 'new'; captureKey: string; text?: string }
  | { kind: 'message'; message: ChatMessage };

type Write =
  | { kind: 'create'; input: typeof postMessageInputSchema.Type }
  | { kind: 'edit'; input: typeof editMessageInputSchema.Type };

type PageDraft = {
  text: string;
  savedText: string;
  messageId?: MessageId;
  versionId?: VersionId;
  versionNumber: bigint;
  pending: boolean;
  attempt?: Write;
  error?: unknown;
  conflict?: ChatMessage;
};

/** A created page keeps the same cache identity after it appears in the note's item list. */
export function pageIdentity(target: PageTarget) {
  return target.kind === 'new'
    ? target.captureKey
    : (target.message.captureKey ?? String(target.message.id));
}

const drafts = Atom.family((_identity: string) =>
  Atom.make<PageDraft | undefined>(undefined).pipe(Atom.keepAlive)
);

const pageAtom = (id: NoteId, identity: string) => drafts(`${id}:${identity}`);

function initialDraft(target: PageTarget): PageDraft {
  if (target.kind === 'new')
    return { text: target.text ?? '', savedText: '', versionNumber: 0n, pending: false };

  const version = target.message.versions.find(
    (item) => item.id === target.message.activeVersionId
  );

  return {
    text: version?.text ?? '',
    savedText: version?.text ?? '',
    messageId: target.message.id,
    versionId: version?.id,
    versionNumber: version?.number ?? 0n,
    pending: false
  };
}

async function writePage(write: Write): Promise<ChatMessage> {
  if (write.kind === 'create') return rpc.notes.postMessage.call(write.input);

  try {
    return await rpc.notes.editMessage.call(write.input);
  } catch (error) {
    // A lost edit receipt can be reconciled without creating another immutable version.
    const message = await rpc.notes.message.read({ id: write.input.messageId }).catch(() => null);
    const active = message?.versions.find((version) => version.id === message.activeVersionId);

    if (
      message &&
      active &&
      active.basedOn === write.input.expectedActiveVersionId &&
      active.text === write.input.text.trim()
    )
      return message;

    throw error;
  }
}

function prepareWrite(id: NoteId, target: PageTarget, draft: PageDraft): Write | undefined {
  if (draft.attempt) return draft.attempt;

  if (!draft.text.trim() || draft.text === draft.savedText) return undefined;

  if (draft.messageId && draft.versionId)
    return {
      kind: 'edit',
      input: {
        messageId: draft.messageId,
        text: draft.text,
        expectedActiveVersionId: draft.versionId
      }
    };

  if (target.kind === 'new')
    return {
      kind: 'create',
      input: {
        noteId: id,
        text: draft.text,
        captureKey: target.captureKey,
        requestReply: false,
        format: 'document'
      }
    };

  return undefined;
}

/** Serializes periodic writes through shared local atom ownership, retaining typing and uncertain attempts. */
export function usePageAutosave(id: NoteId, target: PageTarget) {
  const { autosaveIntervalSeconds } = useWorkspacePreferences();
  const registry = useContext(RegistryContext);
  const identity = pageIdentity(target);
  const atom = pageAtom(id, identity);
  const initial = useMemo(() => initialDraft(target), [target]);

  useAtomInitialValues([[atom, registry.get(atom) ?? initial]]);
  const stored = useAtomValue(atom);
  const draft = stored ?? initial;

  const patch = (update: (value: PageDraft) => PageDraft) =>
    registry.set(atom, update(registry.get(atom) ?? initial));

  const ownerRef = useRef({ identity, target });

  if (ownerRef.current.identity !== identity) ownerRef.current = { identity, target };

  const owner = ownerRef.current.target;

  useEffect(() => {
    const stop = repeatRequest(
      () => persistPage(registry, id, owner),
      autosaveIntervalSeconds * 1000
    );

    return () => {
      stop();
      void persistPage(registry, id, owner);
    };
  }, [registry, id, owner, autosaveIntervalSeconds]);
  useEffect(() => {
    if (target.kind !== 'message') return;

    const incoming = initialDraft(target);

    registry.set(
      atom,
      ((value) =>
        value &&
        !value.pending &&
        !value.attempt &&
        value.text === value.savedText &&
        incoming.versionNumber > value.versionNumber
          ? incoming
          : value)(registry.get(atom))
    );
  }, [registry, id, identity, target, atom]);

  function acceptSavedVersion() {
    if (!draft.conflict) return;

    const incoming = initialDraft({ kind: 'message', message: draft.conflict });

    patch(() => incoming);
  }

  return {
    draft,
    identity,
    setText: (text: string) => patch((value) => ({ ...value, text })),
    save: () => persistPage(registry, id, target, true),
    acceptSavedVersion
  };
}

/** Takes write ownership before awaiting transport so remounts and timer ticks cannot replay it. */
async function persistPage(
  registry: AtomRegistry.AtomRegistry,
  id: NoteId,
  target: PageTarget,
  manual = false
) {
  const atom = pageAtom(id, pageIdentity(target));
  const initial = initialDraft(target);
  const current = registry.get(atom) ?? initial;

  if (current.pending || (!manual && current.error)) return;

  const write = prepareWrite(id, target, current);

  if (!write) return;

  const patch = (update: (value: PageDraft) => PageDraft) =>
    registry.set(atom, update(registry.get(atom) ?? initial));

  patch((value) => ({ ...value, pending: true, attempt: write, error: undefined }));

  try {
    const message = await writePage(write);

    patch((value) => committedPage(value, write, message));
    // Flush typing received during the write, even if its editor has since unmounted.
    await persistPage(registry, id, target);
  } catch (error) {
    const conflict =
      current.messageId && toStudyError(error).kind === 'invalid_input'
        ? await rpc.notes.message.read({ id: current.messageId! }).catch(() => undefined)
        : undefined;

    patch((value) => ({ ...value, pending: false, error, conflict }));
  }
}

function committedPage(value: PageDraft, write: Write, message: ChatMessage): PageDraft {
  const active = message.versions.find((version) => version.id === message.activeVersionId);

  if (write.kind === 'create' && active?.id !== message.versions[0]?.id)
    return {
      ...value,
      messageId: message.id,
      pending: false,
      error: new StudyError('invalid_input', 'Page changed before capture was confirmed'),
      conflict: message
    };

  return {
    ...value,
    messageId: message.id,
    versionId: message.activeVersionId ?? undefined,
    versionNumber: active?.number ?? value.versionNumber,
    savedText: write.input.text,
    pending: false,
    attempt: undefined,
    error: undefined,
    conflict: undefined
  };
}
