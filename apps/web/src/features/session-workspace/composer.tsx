import { StudyError } from '@study/contracts/errors';
import type { SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ComposerSurface } from '@study/ui/composer';
import { Loading } from '@study/ui/loading';
import { Notebook } from '@study/ui/session-workspace';
import { Sparkles, SlidersHorizontal, ArrowUp } from 'lucide-react';

import { Attachments } from './attachments';
import { useComposer } from './composer.queries';
import { sessionKey } from './session-workspace.queries';
import { SessionError } from './status';
import { UnavailableAttempt } from './unavailable-attempt';

type ComposerModel = ReturnType<typeof useComposer>;

export function Composer({ id }: { id: SessionId }) {
  const model = useComposer(id);
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
      <ComposerSurface.Input
        id={`session-note-${id}`}
        rows={3}
        value={draft.text}
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key === 'Enter' &&
            !event.nativeEvent.isComposing
          ) {
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
        <Attachments id={id} blocked={blocked} />
        <ComposerPreferences model={model} />
        <ComposerActions model={model} />
      </ComposerSurface.Footer>
      <ComposerSurface.Hint className="sr-only" id={`session-draft-help-${id}`}>
        {t('SessionNotebookHint')}
      </ComposerSurface.Hint>
      <AskRecovery model={model} />
      <NoteRecovery model={model} />
    </ComposerSurface.Root>
  );
}

function ComposerPreferences({ model }: { model: ComposerModel }) {
  const { t, locale, draft, setDraft, blocked } = model;

  return (
    <>
      <Notebook.Preferences>
        <summary title={t('SessionGenerationPreferences')}>
          <SlidersHorizontal size={16} aria-hidden="true" />
          <Notebook.AccessibleText>{t('SessionGenerationPreferences')}</Notebook.AccessibleText>
        </summary>
        <Notebook.Actions role="group" aria-label={t('SessionAnswerDetail')}>
          {(['brief', 'balanced', 'detailed'] as const).map((detail) => (
            <Button
              key={detail}
              size="sm"
              variant="ghost"
              aria-pressed={(draft.preferences?.detail ?? 'balanced') === detail}
              disabled={blocked}
              onClick={() =>
                setDraft((previous) => ({
                  ...previous,
                  preferences: { language: locale, ...previous.preferences, detail }
                }))
              }
            >
              {t(
                detail === 'brief'
                  ? 'SessionDetailBrief'
                  : detail === 'balanced'
                    ? 'SessionDetailBalanced'
                    : 'SessionDetailDetailed'
              )}
            </Button>
          ))}
        </Notebook.Actions>
      </Notebook.Preferences>
    </>
  );
}

function ComposerActions({ model }: { model: ComposerModel }) {
  const {
    t,
    draft,
    sourceIds,
    filesBlocked,
    selection,
    dirtySelection,
    blocked,
    submitNote,
    submitAsk
  } = model;

  return (
    <>
      <Notebook.Actions>
        <Button
          size="sm"
          variant="ghost-muted"
          disabled={
            blocked ||
            filesBlocked ||
            (!draft.text.trim() && !sourceIds.length) ||
            !selection.data ||
            !!dirtySelection.data
          }
          onClick={submitAsk}
        >
          {t('SessionAsk')}
          <Sparkles size={15} aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          className="ui-composer-submit"
          aria-label={t('SessionSaveNote')}
          title={t('SessionSaveNote')}
          disabled={blocked || filesBlocked || (!draft.text.trim() && !sourceIds.length)}
          onClick={submitNote}
        >
          <ArrowUp size={18} aria-hidden="true" />
        </Button>
      </Notebook.Actions>
    </>
  );
}

function AskRecovery({ model }: { model: ComposerModel }) {
  const { t, draft, dirtySelection, askMutation, pending, retryAsk } = model;

  const retryable = canRetryAsk(model);

  return (
    <>
      {pending && <Loading label={t('SessionSaving')} />}
      {dirtySelection.data && <p role="status">{t('SessionSelectionUnsaved')}</p>}
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
