import type { chatMessageSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import type { VersionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Textarea } from '@study/ui/textarea';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Pencil,
  MessageSquare,
  RotateCcw,
  Sparkles,
  AlignLeft,
  SlidersHorizontal,
  Check
} from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
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
import { ExecutionStatus, SessionError } from './status';

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
export function MessageActions({
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
  async function execute(attempt: Attempt) {
    const current = cache.getQueryData<State>(key);
    if (current?.pending) return;
    patch({ pending: true, attempt, error: undefined, reviewed: false });
    try {
      let requestId: string | undefined;
      if (attempt.action === 'ask') {
        requestId = (await ask(attempt.askInput!)).requestId;
      } else {
        // These APIs target a message's active version, never a historical version.
        const latest = await request((rpc) => rpc['conversations.message']({ id: message.id }));
        if (attempt.action !== 'activate' && latest.activeVersionId !== attempt.versionId)
          throw new StudyError('invalid_input', 'Active message version changed');
        if (attempt.action === 'edit')
          await editNote({ messageId: message.id, text: attempt.text });
        else if (attempt.action === 'activate')
          await activateVersion({ messageId: message.id, versionId: attempt.versionId });
        else if (attempt.action === 'answer')
          requestId = (await reanswerNote(message.id)).requestId;
        else
          requestId = (
            await rewriteNote({
              messageId: message.id,
              origin: attempt.action,
              instruction: attempt.action === 'instruction' ? attempt.instruction : undefined
            })
          ).requestId;
      }
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
  function submit() {
    if (!draft.mode || blocked || !version) return;
    const attempt: Attempt = {
      action: draft.mode,
      versionId: draft.targetVersionId ?? versionId,
      text: draft.text,
      instruction: draft.instruction
    };
    if (draft.mode === 'ask') {
      if (!selection.data || dirty.data || !draft.instruction.trim()) return;
      attempt.askInput = {
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
        preferences: cache.getQueryData<Draft>([
          'session-drafts',
          String(message.sessionId),
          'note'
        ])?.preferences ?? { language: locale }
      };
    }
    void execute(attempt);
  }
  return (
    <>
      <div className="session-row-tools" role="group" aria-label={t('SessionItemActions')}>
        {active && (
          <>
            {message.role === 'user' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={blocked}
                onClick={() => open('edit')}
                title={t('SessionEditNote')}
              >
                <Pencil size={15} aria-hidden="true" />
                <span className="session-action-label">{t('SessionEditNote')}</span>
              </Button>
            )}
            {message.role === 'user' ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={blocked}
                onClick={() => open('ask')}
                title={t('SessionAsk')}
              >
                <MessageSquare size={15} aria-hidden="true" />
                <span className="session-action-label">{t('SessionAsk')}</span>
              </Button>
            ) : (
              message.replyTo !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={blocked}
                  onClick={() => open('answer')}
                  title={t('SessionReanswer')}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  <span className="session-action-label">{t('SessionReanswer')}</span>
                </Button>
              )
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={blocked}
              onClick={() => open('improve')}
              title={t('SessionImprove')}
            >
              <Sparkles size={15} aria-hidden="true" />
              <span className="session-action-label">{t('SessionImprove')}</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={blocked}
              onClick={() => open('summarize')}
              title={t('SessionSummarize')}
            >
              <AlignLeft size={15} aria-hidden="true" />
              <span className="session-action-label">{t('SessionSummarize')}</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={blocked}
              onClick={() => open('instruction')}
              title={t('SessionCustomTransform')}
            >
              <SlidersHorizontal size={15} aria-hidden="true" />
              <span className="session-action-label">{t('SessionCustomTransform')}</span>
            </Button>
          </>
        )}
        {!active && (
          <Button
            size="sm"
            variant="ghost"
            disabled={blocked}
            onClick={() => open('activate')}
            title={t('SessionUseVersion')}
          >
            <Check size={15} aria-hidden="true" />
            <span className="session-action-label">{t('SessionUseVersion')}</span>
          </Button>
        )}
      </div>
      {draft.mode && (
        <section ref={editor} className="session-item-editor" aria-label={t('SessionItemActions')}>
          <p className="session-muted">
            {t(
              draft.mode === 'ask'
                ? 'SessionItemAskScope'
                : draft.mode === 'answer'
                  ? 'SessionItemReanswerScope'
                  : 'SessionItemTransformScope'
            )}{' '}
            · {t('ReaderVersion')} {String(draft.targetNumber ?? '')}
          </p>
          <blockquote className="session-target-preview">{draft.targetText}</blockquote>
          {draft.mode === 'edit' && (
            <Textarea
              aria-label={t('SessionEditNote')}
              value={draft.text}
              disabled={!!draft.attempt}
              onChange={(event) => patch({ text: event.target.value })}
            />
          )}
          {(draft.mode === 'instruction' || draft.mode === 'ask') && (
            <Textarea
              aria-label={t('SessionInstructions')}
              maxLength={draft.mode === 'instruction' ? 4000 : 100000}
              value={draft.instruction}
              disabled={!!draft.attempt}
              onChange={(event) => patch({ instruction: event.target.value })}
            />
          )}
          <div className="session-actions">
            <Button
              size="sm"
              disabled={
                blocked ||
                (draft.mode === 'edit' && !draft.text.trim()) ||
                ((draft.mode === 'instruction' || draft.mode === 'ask') &&
                  !draft.instruction.trim()) ||
                (draft.mode === 'ask' && (!selection.data || !!dirty.data))
              }
              onClick={submit}
            >
              {t(
                draft.mode === 'edit'
                  ? 'SessionSaveNote'
                  : draft.mode === 'ask'
                    ? 'SessionAsk'
                    : 'SessionApplyAction'
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!!draft.attempt}
              onClick={() => patch({ mode: undefined })}
            >
              {t('SessionCancel')}
            </Button>
          </div>
        </section>
      )}
      {draft.pending && <p role="status">{t('SessionSaving')}</p>}
      {draft.error && (
        <SessionError
          error={draft.error}
          retry={
            draft.attempt?.askInput && !draft.pending
              ? () => void execute(draft.attempt!)
              : undefined
          }
        />
      )}
      {draft.attempt && !draft.pending && (
        <div className="session-action-recovery">
          <p>{t(draft.attempt.askInput ? 'SessionAskRetryHelp' : 'SessionItemActionUncertain')}</p>
          {!draft.error && draft.attempt.askInput && (
            <Button size="sm" onClick={() => void execute(draft.attempt!)}>
              {t('SessionRetryAsk')}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
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
            }}
          >
            {t('LibraryRefresh')}
          </Button>
          {(draft.reviewed ||
            (draft.error && toStudyError(draft.error).kind === 'invalid_input')) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                patch({ attempt: undefined, error: undefined, mode: undefined, reviewed: false })
              }
            >
              {t('SessionReviewedHistory')}
            </Button>
          )}
        </div>
      )}
      {draft.requestId && <ExecutionStatus requestId={draft.requestId} />}
    </>
  );
}
