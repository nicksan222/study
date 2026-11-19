import { StudyError } from '@study/contracts';
import type { NoteId } from '@study/contracts';
import { ComposeIcon } from '@study/icons';
import {
  Button,
  Loading,
  Notebook,
  NotebookComposer,
  WorkspaceDeskSurface as Desk
} from '@study/ui';
import { useEffect, useRef, useState } from 'react';

import {
  DictationButton,
  DictationSubmissionScope,
  useDictationSubmission,
  useTextDictation
} from '#client/features/voice/index.ts';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { AttachmentPicker, AttachmentTray } from './attachments';
import { useComposer } from './composer.queries';
import { isNoteSubmit } from './draft';
import { NoteError } from './status';
import { UnavailableAttempt } from './unavailable-attempt';

type ComposerModel = ReturnType<typeof useComposer>;

/** Composes notes, questions and attachments while preserving mixed clipboard content. */
export function Composer({
  id,
  onPage,
  docked = false
}: {
  id: NoteId;
  onPage?: () => void;
  docked?: boolean;
}) {
  const model = useComposer(id);
  const preferences = useWorkspacePreferences();
  const { t, draft, files, blocked, setDraft, submitNote } = model;
  const capture = useCaptureState(model);
  const input = useRef<HTMLTextAreaElement>(null);
  const submission = useDictationSubmission();
  const submit = () => {
    if (!submission.isBlocked()) submitNote();
  };
  const dictation = useTextDictation({
    value: draft.text,
    onChange: (text) => setDraft((previous) => ({ ...previous, text })),
    input
  });

  const form = (
    <NotebookComposer
      inputRef={input}
      inputId={`note-note-${id}`}
      label={t('NoteCompose')}
      hint={t('NoteNotebookHint')}
      placeholder={t('NoteComposeHint')}
      submitLabel={t('NoteSaveNote')}
      value={draft.text}
      spellcheck={preferences.spellcheck}
      onChange={(text) => setDraft((previous) => ({ ...previous, text }))}
      onSubmit={submit}
      disabled={
        blocked ||
        submission.blocked ||
        model.filesBlocked ||
        (!draft.text.trim() && !model.sourceIds.length)
      }
      onDragOver={(event) => {
        if (!blocked) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!blocked) files.add(Array.from(event.dataTransfer.files));
      }}
      onPaste={(event) => {
        if (event.clipboardData.files.length && !blocked) {
          if (!event.clipboardData.getData('text/plain')) event.preventDefault();

          files.add(Array.from(event.clipboardData.files));
        }
      }}
      onKeyDown={(event) => {
        if (isNoteSubmit(event, preferences.submitOnEnter)) {
          event.preventDefault();
          submit();
        }
      }}
      attachments={<AttachmentTray id={id} blocked={blocked} />}
      tools={
        <>
          <AttachmentPicker id={id} blocked={blocked} />
          <DictationSubmissionScope value={submission.scope}>
            <DictationButton
              targetKey={id}
              {...dictation}
              disabled={blocked || !(docked || capture.open)}
            />
          </DictationSubmissionScope>
          {onPage && (
            <Button
              variant="ghost-muted"
              size="sm"
              disabled={blocked || submission.blocked}
              onClick={() => {
                if (!submission.isBlocked()) onPage();
              }}
            >
              <ComposeIcon size={16} aria-hidden="true" />
              {t('NoteWritePage')}
            </Button>
          )}
        </>
      }
      recovery={<ComposerRecovery model={model} />}
    />
  );

  return docked ? (
    form
  ) : (
    <Desk.Capture {...capture} label={t('NoteAddCapture')} closeLabel={t('NoteHideCapture')}>
      {form}
    </Desk.Capture>
  );
}

function useCaptureState(model: ComposerModel) {
  const { draft, files, blocked } = model;
  const [expanded, setExpanded] = useState(() => !!draft.text || files.items.length > 0);
  const wasPending = useRef(model.pending);
  const recovery = blocked || !!model.noteMutation.error || !!model.askMutation.error;
  const required = recovery || files.items.length > 0;
  const open = expanded || required;

  useEffect(() => {
    if (wasPending.current && !model.pending && !recovery && !draft.text && !files.items.length)
      setExpanded(false);

    wasPending.current = model.pending;
  }, [model.pending, recovery, draft.text, files.items.length]);

  return { open, onOpenChange: required ? undefined : setExpanded };
}

function AskRecovery({ model }: { model: ComposerModel }) {
  const { t, draft, askMutation, pending, retryAsk } = model;

  const retryable = canRetryAsk(model);

  return (
    <>
      {pending && <Loading label={t('NoteSaving')} />}
      {askMutation.error && !draft.askUnavailable && (
        <NoteError
          error={askMutation.error}
          retry={retryable ? () => retryAsk(draft.askAttempt!) : undefined}
        />
      )}
      {retryable && !askMutation.error && (
        <Button variant="outline" onClick={() => retryAsk(draft.askAttempt!)}>
          {t('NoteRetryAsk')}
        </Button>
      )}
      {retryable && <Notebook.Muted>{t('NoteAskRetryHelp')}</Notebook.Muted>}
      <UnavailableAsk model={model} />
      <AskConflict model={model} />
    </>
  );
}

function NoteRecovery({ model }: { model: ComposerModel }) {
  const { t, draft, setDraft, noteMutation, pending } = model;

  return (
    <>
      {draft.noteAttempt !== undefined && !pending && (
        <>
          {noteMutation.error && <NoteError error={noteMutation.error} />}
          <p>{t('NoteNoteUncertain')}</p>
          <Button
            variant="outline"
            onClick={() => {
              setDraft((previous) => ({ ...previous, noteAttempt: undefined }));
              noteMutation.reset();
            }}
          >
            {t('NoteReviewedHistory')}
          </Button>
        </>
      )}
    </>
  );
}

function canRetryAsk({ draft, pending }: ComposerModel) {
  return !!draft.askAttempt && !pending && !draft.askUnavailable;
}

function UnavailableAsk({ model }: { model: ComposerModel }) {
  const { id, draft, pending, setDraft, askMutation } = model;

  return (
    <>
      {draft.askAttempt && draft.askUnavailable && (
        <UnavailableAttempt
          key={draft.askAttempt.intentKey}
          id={id}
          busy={pending}
          onAbandon={() => {
            setDraft((previous) =>
              previous.pending || previous.askAttempt?.intentKey !== draft.askAttempt?.intentKey
                ? previous
                : { ...previous, askAttempt: undefined, askUnavailable: undefined }
            );
            askMutation.reset();
          }}
        />
      )}
    </>
  );
}

function AskConflict({ model }: { model: ComposerModel }) {
  const { t, askMutation, setDraft, selection } = model;

  return (
    <>
      {askMutation.error instanceof StudyError && askMutation.error.kind === 'invalid_input' && (
        <Button
          variant="ghost"
          onClick={() => {
            setDraft((previous) => ({ ...previous, askAttempt: undefined }));
            askMutation.reset();
            void selection.refetch();
          }}
        >
          {t('NoteReviewConflict')}
        </Button>
      )}
    </>
  );
}

/** Keeps uncertain-write and request recovery available in either capture presentation. */
function ComposerRecovery({ model }: { model: ComposerModel }) {
  return (
    <>
      <AskRecovery model={model} />
      <NoteRecovery model={model} />
    </>
  );
}
