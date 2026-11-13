import type { VersionId } from '@study/contracts/ids';
import type { StaticMessageKey } from '@study/localization';
import { Button } from '@study/ui/button';
import { ChatMessageActionToolbar } from '@study/ui/chat';
import { Dialog, DialogPopup } from '@study/ui/dialog';
import { DialogHeading } from '@study/ui/dialog-heading';
import { Loading } from '@study/ui/loading';
import { Notebook } from '@study/ui/note-workspace';
import { Textarea } from '@study/ui/textarea';
import { Tooltip, TooltipTrigger, TooltipPopup } from '@study/ui/tooltip';
import { WorkspaceSurface } from '@study/ui/workspace';
import {
  Pencil,
  Sparkles,
  AlignLeft,
  SlidersHorizontal,
  Check,
  Archive,
  FileText
} from 'lucide-react';
import type { ReactNode } from 'react';

import { AiReadinessNotice } from '#client/lib/ai-readiness-notice.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';

import { useItemArchive } from './archive.queries';
import { FailedMessageConversion } from './failed-conversion';
import { useMessageActions } from './message-actions.queries';
import { MessageContextMenu } from './message-context-menu';
import { MessageDeletion } from './message-deletion';
import { MessageVersionStepper } from './message-version-stepper';
import { NoteEditor } from './note-editor';
import { PendingMessageWork } from './pending-message-work';
import { NoteError } from './status';

type MessageActionsModel = ReturnType<typeof useMessageActions>;

/** Keeps message actions and recoverable conversion work beside the selected version. */
export function MessageActions({
  children,
  onVersionChange,
  questionAction,
  ...props
}: Parameters<typeof useMessageActions>[0] & {
  children?: ReactNode;
  onVersionChange?: (id: VersionId) => void;
  questionAction?: ReactNode;
}) {
  const model = useMessageActions(props);
  const { draft } = model;

  return (
    <>
      <MessageContextMenu model={model}>
        {children}
        <MessageToolbar
          model={model}
          onVersionChange={onVersionChange}
          questionAction={questionAction}
        />
      </MessageContextMenu>
      <AiReadinessNotice state={model.readiness} />
      {model.conversion.available && model.conversion.readiness !== model.readiness && (
        <AiReadinessNotice state={model.conversion.readiness} />
      )}
      {model.conversion.mutation.error && (
        <NoteError error={model.conversion.mutation.error} retry={model.conversion.retry} />
      )}
      {props.message.versions
        .filter(
          (version) =>
            version.origin === 'convert' &&
            (version.status === 'pending' || version.status === 'writing') &&
            version.id !== props.versionId
        )
        .map((version) => (
          <PendingMessageWork
            key={String(version.id)}
            noteId={props.message.noteId}
            messageId={props.message.id}
            versionId={version.id}
          />
        ))}
      {props.message.versions
        .filter((version) => version.origin === 'convert' && version.status === 'failed')
        .map((version) => (
          <FailedMessageConversion
            key={String(version.id)}
            message={props.message}
            version={version}
          />
        ))}
      <MessageEditDialog model={model} />
      {!draft.mode && <MessageRecovery model={model} />}
    </>
  );
}

/** Shows the actions available for the current selection and draft state. */
function MessageToolbar({
  model,
  onVersionChange,
  questionAction
}: {
  model: MessageActionsModel;
  onVersionChange?: (id: VersionId) => void;
  questionAction?: ReactNode;
}) {
  const { message, t, active, draft } = model;

  return (
    <ChatMessageActionToolbar
      aria-label={t('NoteItemActions')}
      data-open={!!draft.mode || undefined}
    >
      {message.role === 'user' && (
        <MessageActionButton
          model={model}
          mode="edit"
          disabled={!active}
          label="NoteEditNote"
          icon={<Pencil size={15} aria-hidden="true" />}
        />
      )}
      {onVersionChange && (
        <MessageVersionStepper
          message={message}
          versionId={model.versionId}
          disabled={model.blocked || !!draft.mode}
          onChange={onVersionChange}
        />
      )}
      <>
        <MessageActionButton
          model={model}
          mode="improve"
          disabled={!active}
          label="NoteImprove"
          icon={<Sparkles size={15} aria-hidden="true" />}
        />
        <MessageActionButton
          model={model}
          mode="summarize"
          disabled={!active}
          label="NoteSummarize"
          icon={<AlignLeft size={15} aria-hidden="true" />}
        />
        <MessageActionButton
          model={model}
          mode="instruction"
          disabled={!active}
          label="NoteCustomTransform"
          icon={<SlidersHorizontal size={15} aria-hidden="true" />}
        />
      </>
      <MessageActionButton
        model={model}
        mode="activate"
        disabled={active}
        label="NoteUseVersion"
        icon={<Check size={15} aria-hidden="true" />}
      />
      <MessageConversionButton model={model} />
      {questionAction}
      <MessageArchiveButton model={model} />
      <MessageDeletion
        message={message}
        versionId={model.versionId}
        disabled={model.blocked || !!draft.mode}
        onVersionDeleted={
          onVersionChange ? () => onVersionChange(message.activeVersionId!) : undefined
        }
      />
    </ChatMessageActionToolbar>
  );
}

/** Exposes the conversion action with the same pointer and keyboard help as other actions. */
function MessageConversionButton({ model }: { model: MessageActionsModel }) {
  if (!model.conversion.available) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            disabled={
              !model.active ||
              model.blocked ||
              !!model.draft.mode ||
              model.conversion.readiness !== 'ready' ||
              model.conversion.blocked ||
              model.conversion.mutation.isPending
            }
            onClick={model.conversion.convert}
          />
        }
      >
        <FileText size={15} aria-hidden="true" />
        <Notebook.ActionLabel>{model.t('NoteConvertText')}</Notebook.ActionLabel>
      </TooltipTrigger>
      <TooltipPopup role="tooltip">{model.t('NoteConvertText')}</TooltipPopup>
    </Tooltip>
  );
}

function MessageArchiveButton({ model }: { model: MessageActionsModel }) {
  const archive = useItemArchive(model.message.noteId, {
    kind: 'message',
    id: model.message.id
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            disabled={archive.pending || model.blocked || !!model.draft.mode}
            onClick={() => archive.change(true)}
          />
        }
      >
        <Archive size={15} aria-hidden="true" />
        <Notebook.ActionLabel>{model.t('NoteArchive')}</Notebook.ActionLabel>
      </TooltipTrigger>
      <TooltipPopup>{model.t('NoteArchive')}</TooltipPopup>
    </Tooltip>
  );
}

function MessageActionButton({
  model,
  mode,
  label,
  icon,
  disabled = false
}: {
  model: MessageActionsModel;
  mode: Parameters<MessageActionsModel['open']>[0];
  label: StaticMessageKey;
  icon: ReactNode;
  disabled?: boolean;
}) {
  const help: Partial<Record<NonNullable<MessageActionsModel['draft']['mode']>, StaticMessageKey>> =
    {
      edit: 'NoteEditHelp',
      improve: 'NoteImproveHelp',
      summarize: 'NoteSummarizeHelp',
      instruction: 'NoteCustomTransformHelp',
      activate: 'NoteActivateHelp'
    };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            disabled={
              disabled ||
              model.blocked ||
              !!model.draft.mode ||
              (mode !== 'edit' && mode !== 'activate' && model.readiness !== 'ready')
            }
            onClick={() => model.open(mode)}
          />
        }
      >
        {icon}
        <Notebook.ActionLabel>{model.t(label)}</Notebook.ActionLabel>
      </TooltipTrigger>
      <TooltipPopup>{model.t(help[mode] ?? label)}</TooltipPopup>
    </Tooltip>
  );
}

function MessageEditDialog({ model }: { model: MessageActionsModel }) {
  const { draft, t, patch } = model;
  const labels = {
    edit: 'NoteEditNote',
    improve: 'NoteImprove',
    summarize: 'NoteSummarize',
    instruction: 'NoteCustomTransform',
    activate: 'NoteUseVersion',
    ask: 'NoteAsk',
    answer: 'NoteReply'
  } as const;

  return (
    <Dialog
      open={!!draft.mode}
      onOpenChange={(open) => {
        if (!open && !draft.attempt) patch({ mode: undefined });
      }}
    >
      <DialogPopup
        closeLabel={t('Close')}
        variant="workspace-context"
        showCloseButton={!draft.attempt}
        finalFocus={model.launcher}
        initialFocus={() =>
          model.editor.current?.querySelector<HTMLElement>('[contenteditable="true"], textarea') ??
          model.editor.current?.querySelector<HTMLElement>('button:not(:disabled)') ??
          null
        }
      >
        <DialogHeading
          title={<> {t(draft.mode ? labels[draft.mode] : 'NoteItemActions')} </>}
          description={
            <>
              {t(
                draft.mode === 'edit'
                  ? 'NoteEditHelp'
                  : draft.mode === 'activate'
                    ? 'NoteActivateHelp'
                    : messageScope(draft.mode)
              )}
              {' · '}
              {t('ReaderVersion')} {String(draft.targetNumber ?? '')}
            </>
          }
        />
        <WorkspaceSurface.ContextDialogBody>
          <MessageEditor model={model} />
          <MessageRecovery model={model} />
        </WorkspaceSurface.ContextDialogBody>
      </DialogPopup>
    </Dialog>
  );
}

function MessageEditor({ model }: { model: MessageActionsModel }) {
  const { t, draft, editor, patch, submit } = model;

  return (
    <>
      <Notebook.ItemEditor ref={editor} aria-label={t('NoteItemActions')}>
        {draft.mode !== 'edit' && (
          <Notebook.TargetPreview>{draft.targetText}</Notebook.TargetPreview>
        )}
        {draft.mode === 'edit' && <MessageTextEditor model={model} />}
        {(draft.mode === 'instruction' || draft.mode === 'ask') && (
          <Textarea
            aria-label={t('NoteInstructions')}
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
            {t('NoteCancel')}
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
      {draft.pending && <Loading label={t('NoteSaving')} />}
      {draft.error && (
        <NoteError
          error={draft.error}
          retry={
            draft.attempt?.askInput && !draft.pending && model.readiness === 'ready'
              ? () => void execute(draft.attempt!)
              : undefined
          }
        />
      )}
      {draft.attempt && !draft.pending && <MessageAttemptRecovery model={model} />}
    </>
  );
}

function MessageAttemptRecovery({ model }: { model: MessageActionsModel }) {
  const { t, draft, execute, review, patch } = model;

  if (!draft.attempt) return null;

  return (
    <Notebook.ActionRecovery>
      <p>{t(draft.attempt.askInput ? 'NoteAskRetryHelp' : 'NoteItemActionUncertain')}</p>
      {!draft.error && draft.attempt.askInput && (
        <Button
          size="sm"
          disabled={model.readiness !== 'ready'}
          onClick={() => void execute(draft.attempt!)}
        >
          {t('NoteRetryAsk')}
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
          {t('NoteReviewedHistory')}
        </Button>
      )}
    </Notebook.ActionRecovery>
  );
}

function messageActionDisabled({
  draft,
  blocked,
  selection,
  readiness: modelReadiness
}: MessageActionsModel) {
  if (blocked || (draft.mode !== 'edit' && draft.mode !== 'activate' && modelReadiness !== 'ready'))
    return true;

  if (draft.mode === 'edit') return !draft.text.trim();

  if (draft.mode === 'instruction') return !draft.instruction.trim();

  if (draft.mode === 'ask') return !draft.instruction.trim() || !selection.data;

  return false;
}

function messageScope(mode: MessageActionsModel['draft']['mode']) {
  if (mode === 'ask') return 'NoteItemAskScope';

  if (mode === 'answer') return 'NoteItemReanswerScope';

  return 'NoteItemTransformScope';
}

function messageActionLabel(mode: MessageActionsModel['draft']['mode']) {
  if (mode === 'edit') return 'NoteSaveNote';

  if (mode === 'ask') return 'NoteAsk';

  return 'NoteApplyAction';
}

function MessageTextEditor({ model }: { model: MessageActionsModel }) {
  const { message, t, draft, patch } = model;

  return message.format === 'document' ? (
    <NoteEditor
      label={t('NoteEditNote')}
      value={draft.text}
      disabled={!!draft.attempt}
      onChange={(text) => patch({ text })}
    />
  ) : (
    <Textarea
      aria-label={t('NoteEditNote')}
      value={draft.text}
      disabled={!!draft.attempt}
      onChange={(event) => patch({ text: event.target.value })}
    />
  );
}
