import type { ChatMessage } from '@study/contracts/conversations/messages';
import type {
  postMessageInputSchema,
  editMessageInputSchema
} from '@study/contracts/conversations/rpc';
import { StudyError } from '@study/contracts/errors';
import type { SessionId, MessageId, VersionId } from '@study/contracts/ids';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { toStudyError } from '../../lib/study-client/errors';
import { repeatRequest } from '../../lib/study-client/repeat-request';
import { request } from '../../lib/study-client/request';
import { useWorkspacePreferences } from '../../lib/study-client/workspace-preferences.queries';
import { sessionKey } from './session-workspace.queries';

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

/** A created page keeps the same cache identity after it appears in the session's item list. */
export function pageIdentity(target: PageTarget) {
  return target.kind === 'new'
    ? target.captureKey
    : (target.message.captureKey ?? String(target.message.id));
}

const pageKey = (id: SessionId, identity: string) =>
  ['session-drafts', String(id), 'page-autosave', identity] as const;

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
  if (write.kind === 'create')
    return request((rpc) => rpc['conversations.postMessage'](write.input));

  try {
    return await request((rpc) => rpc['conversations.editMessage'](write.input));
  } catch (error) {
    // A lost edit receipt can be reconciled without creating another immutable version.
    const message = await request((rpc) =>
      rpc['conversations.message']({ id: write.input.messageId })
    ).catch(() => null);
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

function prepareWrite(id: SessionId, target: PageTarget, draft: PageDraft): Write | undefined {
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
        sessionId: id,
        text: draft.text,
        captureKey: target.captureKey,
        requestReply: false,
        format: 'document'
      }
    };

  return undefined;
}

/** Serializes periodic writes through shared cache ownership, retaining typing and uncertain attempts. */
export function usePageAutosave(id: SessionId, target: PageTarget) {
  const { autosaveIntervalSeconds } = useWorkspacePreferences();
  const cache = useQueryClient();
  const identity = pageIdentity(target);
  const key = pageKey(id, identity);
  const initial = initialDraft(target);
  const state = useQuery({
    queryKey: key,
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const draft = state.data;
  const patch = (update: (value: PageDraft) => PageDraft) =>
    cache.setQueryData<PageDraft>(key, (value) => update(value ?? initial));

  const ownerRef = useRef({ identity, target });

  if (ownerRef.current.identity !== identity) ownerRef.current = { identity, target };

  const owner = ownerRef.current.target;

  useEffect(() => {
    const stop = repeatRequest(() => persistPage(cache, id, owner), autosaveIntervalSeconds * 1000);

    return () => {
      stop();
      void persistPage(cache, id, owner);
    };
  }, [cache, id, owner, autosaveIntervalSeconds]);
  useEffect(() => {
    if (target.kind !== 'message') return;

    const incoming = initialDraft(target);

    cache.setQueryData<PageDraft>(pageKey(id, identity), (value) =>
      value &&
      !value.pending &&
      !value.attempt &&
      value.text === value.savedText &&
      incoming.versionNumber > value.versionNumber
        ? incoming
        : value
    );
  }, [cache, id, identity, target]);

  function acceptSavedVersion() {
    if (!draft.conflict) return;

    const incoming = initialDraft({ kind: 'message', message: draft.conflict });

    patch(() => incoming);
  }

  return {
    draft,
    identity,
    setText: (text: string) => patch((value) => ({ ...value, text })),
    save: () => persistPage(cache, id, target, true),
    acceptSavedVersion
  };
}

/** Takes write ownership before awaiting transport so remounts and timer ticks cannot replay it. */
async function persistPage(cache: QueryClient, id: SessionId, target: PageTarget, manual = false) {
  const key = pageKey(id, pageIdentity(target));
  const initial = initialDraft(target);
  const current = cache.getQueryData<PageDraft>(key) ?? initial;

  if (current.pending || (!manual && current.error)) return;

  const write = prepareWrite(id, target, current);

  if (!write) return;

  const patch = (update: (value: PageDraft) => PageDraft) =>
    cache.setQueryData<PageDraft>(key, (value) => update(value ?? initial));

  patch((value) => ({ ...value, pending: true, attempt: write, error: undefined }));

  try {
    const message = await writePage(write);

    patch((value) => committedPage(value, write, message));
    refreshPages(cache, id);
    // Flush typing received during the write, even if its editor has since unmounted.
    await persistPage(cache, id, target);
  } catch (error) {
    const conflict =
      current.messageId && toStudyError(error).kind === 'invalid_input'
        ? await request((rpc) => rpc['conversations.message']({ id: current.messageId! })).catch(
            () => undefined
          )
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

function refreshPages(cache: QueryClient, id: SessionId) {
  void cache.invalidateQueries({ queryKey: [...sessionKey(id), 'thread'] });
  void cache.invalidateQueries({ queryKey: ['sessions'] });
}
