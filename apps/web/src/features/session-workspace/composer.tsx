import { StudyError } from '@study/contracts/errors';
import type { SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ComposerSurface } from '@study/ui/composer';
import { Loading } from '@study/ui/loading';
import { Notebook } from '@study/ui/session-workspace';
import { WorkspaceSurface } from '@study/ui/workspace';
import { ArrowUp, FilePenLine } from 'lucide-react';

import { useWorkspacePreferences } from '#web/lib/study-client/workspace-preferences.queries.ts';

import { AttachmentPicker, AttachmentTray } from './attachments';
import { useComposer } from './composer.queries';
import { isNoteSubmit } from './draft';
import { sessionKey } from './session-workspace.queries';
import { SessionError } from './status';
import { UnavailableAttempt } from './unavailable-attempt';

type ComposerModel = ReturnType<typeof useComposer>;

/** Combines quick capture, attachments and request recovery for the active session. */
export function Composer({ id, onDocument }: { id: SessionId; onDocument?: () => void }) {
  const model = useComposer(id);
  const preferences = useWorkspacePreferences();
  const { t, draft, files, blocked, setDraft, submitNote } = model;

  return (
    <ComposerSurface.Root
      variant="notebook"
      aria-label={t('SessionCompose')}
      onDragOver={(event) => {
        if (!blocked) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!blocked) files.add(Array.from(event.dataTransfer.files));
      }}
    >
      <Notebook.Label htmlFor={`session-note-${id}`}>{t('SessionCompose')}</Notebook.Label>
      <AttachmentTray id={id} blocked={blocked} />
      <ComposerSurface.Input
        id={`session-note-${id}`}
        rows={1}
        value={draft.text}
        spellCheck={preferences.spellcheck}
        onPaste={(event) => {
          if (event.clipboardData.files.length && !blocked) {
            if (!event.clipboardData.getData('text/plain')) event.preventDefault();

            files.add(Array.from(event.clipboardData.files));
          }
        }}
        onKeyDown={(event) => {
          if (isNoteSubmit(event, preferences.submitOnEnter)) {
            event.preventDefault();
            submitNote();
          }
        }}
        aria-describedby={`session-draft-help-${id}`}
        placeholder={t('SessionComposeHint')}
        onChange={(event) => {
          const text = event.target.value;

          setDraft((previous) => ({ ...previous, text }));
        }}
      />
      <ComposerSurface.Footer variant="notebook">
        <Notebook.CaptureTools>
          <AttachmentPicker id={id} blocked={blocked} />
          {onDocument && (
            <Button variant="ghost-muted" size="sm" onClick={onDocument} disabled={blocked}>
              <FilePenLine size={16} aria-hidden="true" />
              {t('SessionWritePage')}
            </Button>
          )}
        </Notebook.CaptureTools>
        <ComposerActions model={model} />
      </ComposerSurface.Footer>
      <WorkspaceSurface.ComposerHint id={`session-draft-help-${id}`}>
        {t('SessionNotebookHint')}
      </WorkspaceSurface.ComposerHint>
      <ComposerRecovery model={model} />
    </ComposerSurface.Root>
  );
}

/** Saves captured material into the session stream. */
function ComposerActions({ model }: { model: ComposerModel }) {
  const { t, draft, sourceIds, filesBlocked, blocked, submitNote } = model;

  return (
    <Notebook.Actions>
      <WorkspaceSurface.ComposerSubmit
        aria-label={t('SessionSaveNote')}
        title={t('SessionSaveNote')}
        disabled={blocked || filesBlocked || (!draft.text.trim() && !sourceIds.length)}
        onClick={submitNote}
      >
        <ArrowUp size={18} aria-hidden="true" />
      </WorkspaceSurface.ComposerSubmit>
    </Notebook.Actions>
  );
}

function AskRecovery({ model }: { model: ComposerModel }) {
  const { t, draft, askMutation, pending, retryAsk } = model;

  const retryable = canRetryAsk(model);

  return (
    <>
      {pending && <Loading label={t('SessionSaving')} />}
      {askMutation.error && !draft.askUnavailable && (
        <SessionError
          error={askMutation.error}
          retry={retryable ? () => retryAsk(draft.askAttempt!) : undefined}
        />
      )}
      {retryable && !askMutation.error && (
        <Button variant="outline" onClick={() => retryAsk(draft.askAttempt!)}>
          {t('SessionRetryAsk')}
        </Button>
      )}
      {retryable && <Notebook.Muted>{t('SessionAskRetryHelp')}</Notebook.Muted>}
      <UnavailableAsk model={model} />
      <AskConflict model={model} />
    </>
  );
}

function NoteRecovery({ model }: { model: ComposerModel }) {
  const { id, t, cache, draft, setDraft, noteMutation, pending } = model;

  return (
    <>
      {draft.noteAttempt !== undefined && !pending && (
        <>
          {noteMutation.error && <SessionError error={noteMutation.error} />}
          <p>{t('SessionNoteUncertain')}</p>
          <Button
            variant="outline"
            onClick={() => {
              setDraft((previous) => ({ ...previous, noteAttempt: undefined }));
              noteMutation.reset();
              void cache.invalidateQueries({ queryKey: [...sessionKey(id), 'thread'] });
            }}
          >
            {t('SessionReviewedHistory')}
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
          {t('SessionReviewConflict')}
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
