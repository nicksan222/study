import { Button } from '@study/ui/button';
import { ChatMessageActionToolbar } from '@study/ui/chat';
import { Loading } from '@study/ui/loading';
import { Notebook } from '@study/ui/session-workspace';
import { Textarea } from '@study/ui/textarea';
import { Pencil, Sparkles, AlignLeft, SlidersHorizontal, Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { toStudyError } from '../../lib/study-client/errors';
import { useMessageActions } from './message-actions.queries';
import { NoteEditor } from './note-editor';
import { ExecutionStatus, SessionError } from './status';

type MessageActionsModel = ReturnType<typeof useMessageActions>;

export function MessageActions({
  children,
  ...props
}: Parameters<typeof useMessageActions>[0] & { children?: ReactNode }) {
  const model = useMessageActions(props);
  const { draft } = model;

  return (
    <>
      {draft.mode !== 'edit' && children}
      <MessageToolbar model={model} />
      {draft.mode && <MessageEditor model={model} />}
      <MessageRecovery model={model} />
    </>
  );
}

function MessageToolbar({ model }: { model: MessageActionsModel }) {
  const { message, t, active, blocked, open } = model;

  return (
    <>
      <ChatMessageActionToolbar aria-label={t('SessionItemActions')}>
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
                <Notebook.ActionLabel>{t('SessionEditNote')}</Notebook.ActionLabel>
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={blocked}
              onClick={() => open('improve')}
              title={t('SessionImprove')}
            >
              <Sparkles size={15} aria-hidden="true" />
              <Notebook.ActionLabel>{t('SessionImprove')}</Notebook.ActionLabel>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={blocked}
              onClick={() => open('summarize')}
              title={t('SessionSummarize')}
            >
              <AlignLeft size={15} aria-hidden="true" />
              <Notebook.ActionLabel>{t('SessionSummarize')}</Notebook.ActionLabel>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={blocked}
              onClick={() => open('instruction')}
              title={t('SessionCustomTransform')}
            >
              <SlidersHorizontal size={15} aria-hidden="true" />
              <Notebook.ActionLabel>{t('SessionCustomTransform')}</Notebook.ActionLabel>
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
            <Notebook.ActionLabel>{t('SessionUseVersion')}</Notebook.ActionLabel>
          </Button>
        )}
      </ChatMessageActionToolbar>
    </>
  );
}

function MessageEditor({ model }: { model: MessageActionsModel }) {
  const { t, draft, editor, patch, submit } = model;

  return (
    <>
      <Notebook.ItemEditor ref={editor} aria-label={t('SessionItemActions')}>
        <Notebook.Muted>
          {t(messageScope(draft.mode))} · {t('ReaderVersion')} {String(draft.targetNumber ?? '')}
        </Notebook.Muted>
        {draft.mode !== 'edit' && (
          <Notebook.TargetPreview>{draft.targetText}</Notebook.TargetPreview>
        )}
        {draft.mode === 'edit' && <MessageTextEditor model={model} />}
        {(draft.mode === 'instruction' || draft.mode === 'ask') && (
          <Textarea
            aria-label={t('SessionInstructions')}
            maxLength={draft.mode === 'instruction' ? 4000 : 100000}
            value={draft.instruction}
            disabled={!!draft.attempt}
            onChange={(event) => patch({ instruction: event.target.value })}
          />
        )}
        <Notebook.Actions>
          <Button size="sm" disabled={messageActionDisabled(model)} onClick={submit}>
            {t(messageActionLabel(draft.mode))}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!!draft.attempt}
            onClick={() => patch({ mode: undefined })}
          >
            {t('SessionCancel')}
          </Button>
        </Notebook.Actions>
      </Notebook.ItemEditor>
    </>
  );
}

function MessageRecovery({ model }: { model: MessageActionsModel }) {
  const { t, draft, execute } = model;

  return (
    <>
      {draft.pending && <Loading label={t('SessionSaving')} />}
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
      {draft.attempt && !draft.pending && <MessageAttemptRecovery model={model} />}
      {draft.requestId && <ExecutionStatus requestId={draft.requestId} />}
    </>
  );
}

function MessageAttemptRecovery({ model }: { model: MessageActionsModel }) {
  const { t, draft, execute, review, patch } = model;

  if (!draft.attempt) return null;

  return (
    <Notebook.ActionRecovery>
      <p>{t(draft.attempt.askInput ? 'SessionAskRetryHelp' : 'SessionItemActionUncertain')}</p>
      {!draft.error && draft.attempt.askInput && (
        <Button size="sm" onClick={() => void execute(draft.attempt!)}>
          {t('SessionRetryAsk')}
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={review}>
        {t('LibraryRefresh')}
      </Button>
      {(draft.reviewed ||
        (draft.error !== undefined && toStudyError(draft.error).kind === 'invalid_input')) && (
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
    </Notebook.ActionRecovery>
  );
}

function messageActionDisabled({ draft, blocked, selection, dirty }: MessageActionsModel) {
  if (blocked) return true;

  if (draft.mode === 'edit') return !draft.text.trim();

  if (draft.mode === 'instruction') return !draft.instruction.trim();

  if (draft.mode === 'ask') return !draft.instruction.trim() || !selection.data || !!dirty.data;

  return false;
}

function messageScope(mode: MessageActionsModel['draft']['mode']) {
  if (mode === 'ask') return 'SessionItemAskScope';

  if (mode === 'answer') return 'SessionItemReanswerScope';

  return 'SessionItemTransformScope';
}

function messageActionLabel(mode: MessageActionsModel['draft']['mode']) {
  if (mode === 'edit') return 'SessionSaveNote';

  if (mode === 'ask') return 'SessionAsk';

  return 'SessionApplyAction';
}

function MessageTextEditor({ model }: { model: MessageActionsModel }) {
  const { message, t, draft, patch } = model;

  return message.format === 'document' ? (
    <NoteEditor
      label={t('SessionEditNote')}
      value={draft.text}
      disabled={!!draft.attempt}
      onChange={(text) => patch({ text })}
    />
  ) : (
    <Textarea
      aria-label={t('SessionEditNote')}
      value={draft.text}
      disabled={!!draft.attempt}
      onChange={(event) => patch({ text: event.target.value })}
    />
  );
}
