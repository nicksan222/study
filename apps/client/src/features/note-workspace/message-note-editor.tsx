import { Button, Dialog, DialogTitle, Notebook, NotebookEditor, PreviousButton } from '@study/ui';
import { useRef } from 'react';
import type { ReactNode } from 'react';

import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import type { useMessageActions } from './message-actions.queries';
import { NoteEditor, NoteSummary } from './note-editor';

type Model = ReturnType<typeof useMessageActions>;

/** Keeps manual edits and their reading position separate from transformation dialogs. */
export function MessageNoteEditor({ model, recovery }: { model: Model; recovery: ReactNode }) {
  const { t, draft, patch } = model;
  const preferences = useWorkspacePreferences();
  const body = useRef<HTMLDivElement>(null);
  const position = useRef({ scroll: 0, start: 0, end: 0 });
  const recordingPosition = useRef(false);
  const richSelection = useRef<Range | null>(null);
  const rememberSelection = () => {
    const selection = window.getSelection();

    if (selection?.rangeCount && body.current?.contains(selection.anchorNode))
      richSelection.current = selection.getRangeAt(0).cloneRange();
  };
  const pause = () => {
    // Native caret scrolling can precede its queued scroll/select events. Capture
    // the actual position before closing instead of relying on those events.
    if (body.current) position.current.scroll = body.current.scrollTop;

    const input = body.current?.querySelector('textarea');

    if (input) {
      position.current.start = input.selectionStart;
      position.current.end = input.selectionEnd;
    }

    rememberSelection();
    recordingPosition.current = false;
    model.pauseEdit();
  };
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
        keepMounted={model.message.format === 'document' && (open || !!draft.pausedEdit)}
        closeLabel={t('NoteBackToNotebook')}
        finalFocus={() => {
          (model.launcher.current?.isConnected
            ? model.launcher.current
            : model.origin.current
          )?.focus({ preventScroll: true });

          return false;
        }}
        initialFocus={() => {
          recordingPosition.current = true;
          const input = body.current?.querySelector<HTMLElement>(
            'textarea, [contenteditable="true"]'
          );

          input?.focus({ preventScroll: true });

          if (input instanceof HTMLTextAreaElement)
            input.setSelectionRange(position.current.start, position.current.end);

          if (input?.isContentEditable && richSelection.current?.startContainer.isConnected) {
            const selection = window.getSelection();

            selection?.removeAllRanges();
            selection?.addRange(richSelection.current);
          }

          if (body.current) body.current.scrollTop = position.current.scroll;

          return false;
        }}
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key === 'Enter' &&
            draft.text.trim() &&
            !model.blocked
          ) {
            event.preventDefault();
            model.submit();
          }
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
          ref={body}
          onScroll={(event) => {
            if (recordingPosition.current) position.current.scroll = event.currentTarget.scrollTop;
          }}
        >
          {model.message.format === 'document' ? (
            <NoteEditor
              label={t('NoteEditNote')}
              value={draft.text}
              disabled={!!draft.attempt}
              onChange={(text) => patch({ text })}
            />
          ) : (
            <NotebookEditor.Text
              aria-label={t('NoteEditNote')}
              value={draft.text}
              disabled={!!draft.attempt}
              spellCheck={preferences.spellcheck}
              onChange={(event) => patch({ text: event.target.value })}
              onSelect={(event) => {
                if (!recordingPosition.current) return;

                position.current.start = event.currentTarget.selectionStart;
                position.current.end = event.currentTarget.selectionEnd;
              }}
            />
          )}
        </NotebookEditor.Body>
        <NotebookEditor.Footer>
          <NotebookEditor.Status role="status">
            {t(draft.text === draft.targetText ? 'NoteEditUnchanged' : 'NoteEditUnsaved')}
          </NotebookEditor.Status>
          <Notebook.Actions>
            <Button
              size="sm"
              variant="ghost"
              disabled={!!draft.attempt}
              aria-label={t('NoteDiscardEdits')}
              onClick={() => {
                position.current = { scroll: 0, start: 0, end: 0 };
                richSelection.current = null;
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
              disabled={model.blocked || !draft.text.trim()}
              onClick={model.submit}
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
