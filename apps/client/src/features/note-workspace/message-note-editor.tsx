import { Button, Dialog, DialogTitle, Notebook, NotebookEditor, PreviousButton } from '@study/ui';
import type { ReactNode } from 'react';

import {
  DictationButton,
  DictationSubmissionScope,
  useDictationSubmission,
  useTextDictation
} from '#client/features/voice/index.ts';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { useEditPosition } from './edit-position';
import type { useMessageActions } from './message-actions.queries';
import { NoteEditor, NoteSummary } from './note-editor';

type Model = ReturnType<typeof useMessageActions>;

/** Keeps manual edits and their reading position separate from transformation dialogs. */
export function MessageNoteEditor({ model, recovery }: { model: Model; recovery: ReactNode }) {
  const { t, draft, patch } = model;
  const preferences = useWorkspacePreferences();
  const position = useEditPosition(draft.position);
  const submission = useDictationSubmission();
  const submit = () => {
    if (!submission.isBlocked()) model.submit();
  };
  const dictation = useTextDictation({
    value: draft.text,
    onChange: (text) => patch({ text }),
    input: position.textInput
  });
  const pause = () => model.pauseEdit(position.pause());
  const { source } = position;
  const open = draft.mode === 'edit';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) pause();
      }}
    >
      <NotebookEditor.Popup
        open={open}
        anchor={model.origin}
        aria-busy={!!draft.pending}
        closeLabel={t('NoteBackToNotebook')}
        finalFocus={() => {
          (model.launcher.current?.isConnected
            ? model.launcher.current
            : model.origin.current
          )?.focus({ preventScroll: true });

          return false;
        }}
        initialFocus={position.restore}
        onKeyDownCapture={(event) => {
          if (
            event.nativeEvent.isComposing ||
            (!event.metaKey && !event.ctrlKey) ||
            event.key !== 'Enter'
          )
            return;

          event.preventDefault();
          event.stopPropagation();

          if (draft.text.trim() && !model.blocked) submit();
        }}
      >
        <NotebookEditor.Header>
          <PreviousButton
            aria-label={t('NoteBackToNotebook')}
            label={
              <NotebookEditor.Label
                full={t('NoteBackToNotebook')}
                compact={t('NoteBackToNotebookShort')}
              />
            }
            size="sm"
            variant="ghost"
            disabled={!!draft.attempt}
            onClick={pause}
            title={t('NoteEditBackHelp')}
          />
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={source}
            data-pressed={source || undefined}
            disabled={!!draft.attempt || submission.blocked}
            onClick={() => {
              if (submission.isBlocked()) return;

              patch({ position: position.switchMode() });
            }}
          >
            {t('NoteMarkdownSource')}
          </Button>
          <NotebookEditor.Identity>
            <DialogTitle>{t('NoteEditNote')}</DialogTitle>
            <NotebookEditor.Subject>
              <NoteSummary value={draft.targetText ?? ''} fallback={t('NoteEntryNote')} />
            </NotebookEditor.Subject>
            <NotebookEditor.Metadata>
              {t('ReaderVersion')} {String(draft.targetNumber ?? '')}
            </NotebookEditor.Metadata>
          </NotebookEditor.Identity>
        </NotebookEditor.Header>
        <NotebookEditor.Body
          ref={position.body}
          onScroll={(event) => position.recordScroll(event.currentTarget.scrollTop)}
        >
          {!source ? (
            <DictationSubmissionScope value={submission.scope}>
              <NoteEditor
                targetKey={`${model.message.id}:${draft.targetVersionId}:${draft.mode}`}
                ref={position.richEditor}
                label={t('NoteEditNote')}
                value={draft.text}
                disabled={!!draft.attempt}
                variant="notebook"
                onChange={(text) => patch({ text })}
              />
            </DictationSubmissionScope>
          ) : (
            <NotebookEditor.Text
              ref={position.textInput}
              aria-label={t('NoteEditNote')}
              value={draft.text}
              disabled={!!draft.attempt}
              spellCheck={preferences.spellcheck}
              onChange={(event) => patch({ text: event.target.value })}
              onSelect={(event) => position.recordSelection(event.currentTarget)}
            />
          )}
        </NotebookEditor.Body>
        <NotebookEditor.Footer>
          <NotebookEditor.Status role="status">
            {t(draft.text === draft.targetText ? 'NoteEditUnchanged' : 'NoteEditUnsaved')}
          </NotebookEditor.Status>
          <Notebook.Actions>
            {source && (
              <DictationSubmissionScope value={submission.scope}>
                <DictationButton
                  targetKey={`${model.message.id}:${draft.targetVersionId}:${draft.mode}`}
                  {...dictation}
                  disabled={!!draft.attempt}
                />
              </DictationSubmissionScope>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={!!draft.attempt}
              aria-label={t('NoteDiscardEdits')}
              onClick={() => {
                position.reset();
                model.discardEdit();
              }}
            >
              <NotebookEditor.Label
                full={t('NoteDiscardEdits')}
                compact={t('NoteDiscardEditsShort')}
              />
            </Button>
            <Button
              size="sm"
              aria-label={t('NoteSaveNote')}
              disabled={model.blocked || submission.blocked || !draft.text.trim()}
              onClick={submit}
            >
              <NotebookEditor.Label full={t('NoteSaveNote')} compact={t('Save')} />
            </Button>
          </Notebook.Actions>
          <NotebookEditor.Feedback>{recovery}</NotebookEditor.Feedback>
        </NotebookEditor.Footer>
      </NotebookEditor.Popup>
    </Dialog>
  );
}
