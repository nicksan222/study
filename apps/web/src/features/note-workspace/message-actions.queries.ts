import { StudyError } from '@study/contracts/errors';
import type { VersionId } from '@study/contracts/ids';
import type { chatMessageSchema } from '@study/contracts/notes/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useAiReadiness } from '#web/lib/ai-readiness.ts';
import { useI18n } from '#web/lib/i18n.tsx';
import { request } from '#web/lib/study-client/request.ts';

import { useMessageConversion } from './conversion.queries';
import type { Draft } from './draft';
import {
  activateVersion,
  ask,
  editNote,
  reanswerNote,
  rewriteNote,
  selectionOptions,
  noteKey
} from './note-workspace.queries';
import type { AskInput } from './note-workspace.queries';

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

/** Coordinates version-scoped edits, generation attempts and conversion controls. */
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
  const readiness = useAiReadiness('medium');
  const conversion = useMessageConversion(message, versionId);
  const cache = useQueryClient();
  const key = ['note-drafts', String(message.noteId), 'message-action', String(message.id)];
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
      (
        editor.current?.querySelector<HTMLElement>('[contenteditable="true"], textarea') ??
        editor.current?.querySelector<HTMLElement>('button:not(:disabled)')
      )?.focus();
    else if (!draft.mode && previousMode.current) launcher.current?.focus();

    previousMode.current = draft.mode;
  }, [draft.mode]);
  const patch = (value: Partial<State>) =>
    cache.setQueryData<State>(key, (previous) => ({ ...(previous ?? initial), ...value }));
  const selection = useQuery(selectionOptions(message.noteId));
  const version = message.versions.find((item) => item.id === versionId);
  const active = versionId === message.activeVersionId;
  const blocked = !!draft.attempt || !!draft.pending || version?.status !== 'complete';

  async function runAttempt(attempt: Attempt) {
    let requestId: string | undefined;

    if (attempt.action === 'ask') {
      requestId = (await ask(attempt.askInput!)).requestId;
    } else {
      // These APIs target a message's active version, never a historical version.
      const latest = await request((rpc) => rpc['notes.message']({ id: message.id }));

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

    if (
      current?.pending ||
      (!['edit', 'activate'].includes(attempt.action) && readiness !== 'ready')
    )
      return;

    patch({ pending: true, attempt, error: undefined, reviewed: false });

    try {
      const requestId = await runAttempt(attempt);

      patch({ attempt: undefined, mode: undefined, requestId, error: undefined });

      if (attempt.action === 'activate') onActive();

      void cache.invalidateQueries({ queryKey: noteKey(message.noteId) });
      void cache.invalidateQueries({ queryKey: ['note-work', String(message.noteId)] });
      void cache.invalidateQueries({ queryKey: ['notes'] });
    } catch (error) {
      patch({ error });
    } finally {
      patch({ pending: false });
    }
  }

  function open(mode: Action) {
    if (!blocked && (['edit', 'activate'].includes(mode) || readiness === 'ready')) {
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
    if (!selection.data || !draft.instruction.trim()) return undefined;

    return {
      noteId: message.noteId,
      threadRoot: message.threadRoot ?? undefined,
      expectedSelectionRevision: selection.data.revision,
      intentKey: crypto.randomUUID(),
      text: draft.instruction,
      instruction: JSON.stringify({
        targetMessageId: String(message.id),
        targetVersionId: String(attempt.versionId),
        targetText: draft.targetText
      }),
      preferences: cache.getQueryData<Draft>(['note-drafts', String(message.noteId), 'note'])
        ?.preferences ?? { language: locale }
    };
  }

  function submit() {
    if (
      !draft.mode ||
      blocked ||
      !version ||
      (draft.mode !== 'edit' && draft.mode !== 'activate' && readiness !== 'ready')
    )
      return;

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
        queryKey: [...noteKey(message.noteId), 'action-review', String(message.id)],
        queryFn: () => request((rpc) => rpc['notes.message']({ id: message.id })),
        staleTime: 0
      });
      await cache.invalidateQueries({
        queryKey: [...noteKey(message.noteId), 'thread']
      });
      patch({ reviewed: true });
    } catch (error) {
      patch({ error, reviewed: false });
    }
  }

  return {
    message,
    versionId,
    conversion,
    readiness,
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
    version,
    active,
    blocked,
    execute,
    open,
    submit,
    review
  };
}
