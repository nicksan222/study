import type { chatMessageSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import type { VersionId } from '@study/contracts/ids';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useI18n } from '../../lib/i18n';
import { request } from '../../lib/study-client/request';
import type { Draft } from './draft';
import {
  activateVersion,
  ask,
  editNote,
  reanswerNote,
  rewriteNote,
  selectionOptions,
  sessionKey
} from './session-workspace.queries';
import type { AskInput, Selection } from './session-workspace.queries';

type Message = typeof chatMessageSchema.Type;

type Action = 'edit' | 'ask' | 'answer' | 'improve' | 'summarize' | 'instruction' | 'activate';

type Attempt = {
  action: Action;
  versionId: VersionId;
  text: string;
  instruction: string;
  askInput?: AskInput;
};

type State = {
  targetVersionId?: VersionId;
  targetText?: string;
  targetNumber?: bigint;
  mode?: Action;
  text: string;
  instruction: string;
  attempt?: Attempt;
  pending?: boolean;
  error?: unknown;
  requestId?: string;
  reviewed?: boolean;
};

export function useMessageActions({
  message,
  versionId,
  onActive
}: {
  message: Message;
  versionId: VersionId;
  onActive: () => void;
}) {
  const { t, locale } = useI18n();
  const cache = useQueryClient();
  const key = ['session-drafts', String(message.sessionId), 'message-action', String(message.id)];
  const initial: State = { text: '', instruction: '' };
  const state = useQuery({
    queryKey: key,
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const draft = state.data;
  const editor = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLElement | null>(null);
  const previousMode = useRef<Action | undefined>(undefined);

  useEffect(() => {
    if (draft.mode && previousMode.current !== draft.mode)
      editor.current?.querySelector<HTMLElement>('textarea, button:not(:disabled)')?.focus();
    else if (!draft.mode && previousMode.current) launcher.current?.focus();

    previousMode.current = draft.mode;
  }, [draft.mode]);
  const patch = (value: Partial<State>) =>
    cache.setQueryData<State>(key, (previous) => ({ ...(previous ?? initial), ...value }));
  const selection = useQuery(selectionOptions(message.sessionId));
  const dirty = useQuery({
    queryKey: ['session-drafts', String(message.sessionId), 'selection'],
    queryFn: () => null as Selection | null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const version = message.versions.find((item) => item.id === versionId);
  const active = versionId === message.activeVersionId;
  const blocked = !!draft.attempt || !!draft.pending || version?.status !== 'complete';

  async function runAttempt(attempt: Attempt) {
    let requestId: string | undefined;

    if (attempt.action === 'ask') {
      requestId = (await ask(attempt.askInput!)).requestId;
    } else {
      // These APIs target a message's active version, never a historical version.
      const latest = await request((rpc) => rpc['conversations.message']({ id: message.id }));

      if (attempt.action !== 'activate' && latest.activeVersionId !== attempt.versionId)
        throw new StudyError('invalid_input', 'Active message version changed');

      if (attempt.action === 'edit') await editNote({ messageId: message.id, text: attempt.text });
      else if (attempt.action === 'activate')
        await activateVersion({ messageId: message.id, versionId: attempt.versionId });
      else if (attempt.action === 'answer') requestId = (await reanswerNote(message.id)).requestId;
      else
        requestId = (
          await rewriteNote({
            messageId: message.id,
            origin: attempt.action,
            instruction: attempt.action === 'instruction' ? attempt.instruction : undefined
          })
        ).requestId;
    }

    return requestId;
  }

  async function execute(attempt: Attempt) {
    const current = cache.getQueryData<State>(key);

    if (current?.pending) return;

    patch({ pending: true, attempt, error: undefined, reviewed: false });

    try {
      const requestId = await runAttempt(attempt);

      patch({ attempt: undefined, mode: undefined, requestId, error: undefined });

      if (attempt.action === 'activate') onActive();

      void cache.invalidateQueries({ queryKey: sessionKey(message.sessionId) });
      void cache.invalidateQueries({ queryKey: ['sessions'] });
    } catch (error) {
      patch({ error });
    } finally {
      patch({ pending: false });
    }
  }

  function open(mode: Action) {
    if (!blocked) {
      launcher.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      patch({
        mode,
        targetVersionId: versionId,
        targetText: version?.text ?? '',
        targetNumber: version?.number,
        text: version?.text ?? '',
        instruction: '',
        requestId: undefined
      });
    }
  }

  function prepareQuotedAsk(attempt: Attempt): AskInput | undefined {
    if (!selection.data || dirty.data || !draft.instruction.trim()) return undefined;

    return {
      sessionId: message.sessionId,
      threadRoot: message.threadRoot ?? undefined,
      expectedSelectionRevision: selection.data.revision,
      intentKey: crypto.randomUUID(),
      text: draft.instruction,
      instruction: JSON.stringify({
        targetMessageId: String(message.id),
        targetVersionId: String(attempt.versionId),
        targetText: draft.targetText
      }),
      preferences: cache.getQueryData<Draft>(['session-drafts', String(message.sessionId), 'note'])
        ?.preferences ?? { language: locale }
    };
  }

  function submit() {
    if (!draft.mode || blocked || !version) return;

    const attempt: Attempt = {
      action: draft.mode,
      versionId: draft.targetVersionId ?? versionId,
      text: draft.text,
      instruction: draft.instruction
    };

    if (draft.mode === 'ask') {
      attempt.askInput = prepareQuotedAsk(attempt);

      if (!attempt.askInput) return;
    }

    void execute(attempt);
  }

  async function review() {
    try {
      await cache.fetchQuery({
        queryKey: [...sessionKey(message.sessionId), 'action-review', String(message.id)],
        queryFn: () => request((rpc) => rpc['conversations.message']({ id: message.id })),
        staleTime: 0
      });
      await cache.invalidateQueries({
        queryKey: [...sessionKey(message.sessionId), 'thread']
      });
      patch({ reviewed: true });
    } catch (error) {
      patch({ error, reviewed: false });
    }
  }

  return {
    message,
    versionId,
    t,
    locale,
    cache,
    key,
    initial,
    draft,
    editor,
    launcher,
    patch,
    selection,
    dirty,
    version,
    active,
    blocked,
    execute,
    open,
    submit,
    review
  };
}
