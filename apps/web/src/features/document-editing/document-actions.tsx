import type {
  documentComparisonSchema,
  undoDocumentInputSchema
} from '@study/contracts/materials/editing';
import { Button } from '@study/ui/button';
import { Dialog, DialogPopup, DialogHeader, DialogTitle } from '@study/ui/dialog';
import { DocumentEditing } from '@study/ui/document-editing';
import { ErrorState } from '@study/ui/error-state';
import { Input } from '@study/ui/input';
import { Textarea } from '@study/ui/textarea';
import { Link } from '@tanstack/react-router';

import { useI18n } from '../../lib/i18n';
import { request } from '../../lib/study-client/request';
import { DocumentReader } from '../document-presentation';
import { BlockEditor, authoredCopy } from './block-editor';
import { CreationLibraryReview } from './creation-library-review';
import { useDocumentCreation, useDocumentEditor } from './document-editing.queries';

type Comparison = typeof documentComparisonSchema.Type;

type Creation = ReturnType<typeof useDocumentCreation>['initial'];

export function ComparisonView({ value }: { value: Comparison }) {
  const { t } = useI18n();

  return (
    <DocumentEditing.Comparison>
      <p>{t('DocumentStructuralOnly')}</p>
      {(['before', 'proposed', 'current'] as const).map((kind) => (
        <details key={kind}>
          <summary>
            {t(
              kind === 'before'
                ? 'DocumentBefore'
                : kind === 'proposed'
                  ? 'DocumentSubmitted'
                  : 'ReaderCurrent'
            )}
          </summary>
          {value[kind].content.kind === 'document' && (
            <DocumentReader document={value[kind].content} />
          )}
        </details>
      ))}
    </DocumentEditing.Comparison>
  );
}

export function NewDocument() {
  const view = useDocumentCreation();
  const { t, open, setOpen, title, text, busy, error, createdId, setTitle, setText, submit } = view;

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen((value) => busy || !value)}>
        {t('DocumentNew')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next || !busy) setOpen(next);
        }}
      >
        <DialogPopup closeLabel={t('Close')}>
          <DialogHeader>
            <DialogTitle>{t('DocumentNew')}</DialogTitle>
          </DialogHeader>
          <DocumentEditing.CreationForm onSubmit={submit}>
            <label>
              {t('DocumentTitle')}
              <Input value={title} onValueChange={setTitle} maxLength={200} disabled={busy} />
            </label>
            <label>
              {t('DocumentInitialText')}
              <Textarea
                rows={8}
                value={text}
                onChange={(event) => setText(event.target.value)}
                disabled={busy}
              />
            </label>
            <Button
              type="submit"
              disabled={
                busy || error === 'uncertain' || !!createdId || !title.trim() || !text.trim()
              }
            >
              {t('DocumentCreate')}
            </Button>
            <CreationReceipt view={view} />
          </DocumentEditing.CreationForm>
        </DialogPopup>
      </Dialog>
    </>
  );
}

type DocumentEditor = ReturnType<typeof useDocumentEditor>;

export function DocumentActions(props: Parameters<typeof useDocumentEditor>[0]) {
  const view = useDocumentEditor(props);
  const { t, document } = view;

  if (!document) return null;

  return (
    <DocumentEditing.Editor>
      <h2>{t('DocumentEditing')}</h2>
      <DocumentEditEntry view={view} />
      <DocumentDraft view={view} />
      <DocumentSavedActions view={view} />
      <DocumentCopyStatus view={view} />
    </DocumentEditing.Editor>
  );
}

function DocumentEditEntry({ view }: { view: DocumentEditor }) {
  const {
    t,
    client,
    content,
    document,
    version,
    current,
    draft,
    busy,
    error,
    savedCopy,
    setSavedCopy,
    change,
    run
  } = view;

  if (!document) return null;

  return (
    <>
      {content.kind === 'document' && version.id === current && !draft && (
        <Button onClick={() => change(structuredClone(document))}>{t('DocumentEdit')}</Button>
      )}
      {content.kind !== 'document' && (
        <Button
          disabled={busy || error || !!savedCopy}
          onClick={() =>
            void run(async () => {
              const copy = await request((rpc) =>
                rpc['materials.createManualDocument']({
                  title: t('DocumentCopyTitle'),
                  document: authoredCopy(document),
                  inputVersionId: version.id
                })
              );

              setSavedCopy(String(copy.id));
              await client.invalidateQueries({ queryKey: ['materials'] });
            })
          }
        >
          {t('DocumentEditCopy')}
        </Button>
      )}
    </>
  );
}

function DocumentDraft({ view }: { view: DocumentEditor }) {
  const {
    t,
    client,
    document,
    version,
    draftKey,
    draft,
    busy,
    outcome,
    setOutcome,
    saveKey,
    pendingSave,
    setPendingSave,
    change,
    run,
    discard
  } = view;

  if (!document) return null;

  return (
    <>
      {draft && (
        <>
          <BlockEditor
            document={draft}
            change={change}
            disabled={busy || !!outcome || !!pendingSave}
          />
          <Button
            disabled={busy || !!outcome}
            onClick={() =>
              void run(async () => {
                const input = pendingSave ?? {
                  materialId: version.material_id,
                  expectedVersionId: version.id,
                  saveKey: saveKey.current,
                  document: draft
                };

                setPendingSave(input);
                client.setQueryData([...draftKey, 'pending-save'], input);
                const result = await request((rpc) => rpc['materials.saveDocument'](input));

                setOutcome(result);
                await client.invalidateQueries({ queryKey: ['materials'] });
              })
            }
          >
            {t('DocumentSave')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={discard}>
            {t('DocumentCloseDraft')}
          </Button>
        </>
      )}
    </>
  );
}

function DocumentSavedActions({ view }: { view: DocumentEditor }) {
  const {
    t,
    client,
    version,
    draftKey,
    busy,
    outcome,
    setComparison,
    undoOutcome,
    setUndoOutcome,
    run
  } = view;

  return (
    <>
      {outcome && (
        <p role="status">
          {t(outcome.outcome === 'conflict' ? 'DocumentConflict' : 'DocumentSaved')}
        </p>
      )}
      {outcome && (
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () =>
              setComparison(
                await request((rpc) =>
                  rpc['materials.compareDocument']({
                    beforeVersionId: outcome.expectedVersionId,
                    proposedVersionId: outcome.submittedVersionId,
                    currentVersionId: outcome.currentVersionId
                  })
                )
              )
            )
          }
        >
          {t('DocumentCompare')}
        </Button>
      )}
      {outcome?.outcome === 'saved' && !undoOutcome && (
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const input = client.getQueryData<typeof undoDocumentInputSchema.Type>([
                ...draftKey,
                'undo-input'
              ]) ?? {
                materialId: version.material_id,
                expectedVersionId: outcome.submittedVersionId,
                restoreVersionId: version.id,
                undoKey: crypto.randomUUID()
              };

              client.setQueryData([...draftKey, 'undo-input'], input);
              const result = await request((rpc) => rpc['materials.undoDocument'](input));

              client.setQueryData([...draftKey, 'undo-outcome'], result);
              setUndoOutcome(result);
              await client.invalidateQueries({ queryKey: ['materials'] });
            })
          }
        >
          {t('DocumentUndo')}
        </Button>
      )}
      {undoOutcome && (
        <p role="status">
          {t(undoOutcome.outcome === 'saved' ? 'DocumentUndone' : 'DocumentUndoConflict')}
        </p>
      )}
    </>
  );
}

function DocumentCopyStatus({ view }: { view: DocumentEditor }) {
  const { t, document, draft, busy, error, outcome, comparison, savedCopy, setSavedCopy, run } =
    view;

  if (!document) return null;

  return (
    <>
      {outcome?.outcome === 'conflict' && draft && (
        <Button
          disabled={busy || error || !!savedCopy}
          onClick={() =>
            void run(async () => {
              const copy = await request((rpc) =>
                rpc['materials.createManualDocument']({
                  title: t('DocumentCopyTitle'),
                  document: authoredCopy(draft),
                  inputVersionId: outcome.submittedVersionId
                })
              );

              setSavedCopy(String(copy.id));
            })
          }
        >
          {t('DocumentKeepDraftCopy')}
        </Button>
      )}
      {comparison && <ComparisonView value={comparison} />}
      {savedCopy && (
        <Link to="/materials/$materialId" params={{ materialId: savedCopy }} search={{}}>
          {t('DocumentOpenCopy')}
        </Link>
      )}
      {error && (
        <ErrorState title={t('ErrorStateTitle')} description={<> {t('DocumentActionFailed')} </>} />
      )}
    </>
  );
}

function CreationReceipt({ view }: { view: ReturnType<typeof useDocumentCreation> }) {
  const { t, client, creationKey, initial, submitted, error, createdId, busy } = view;

  return (
    <>
      {submitted && (error === 'uncertain' || createdId) && (
        <DocumentEditing.Submitted aria-label={t('DocumentCreationSubmitted')}>
          <DocumentEditing.SubmittedHeading>
            {t('DocumentCreationSubmitted')}
          </DocumentEditing.SubmittedHeading>
          <DocumentEditing.SubmittedTitle>{submitted.title}</DocumentEditing.SubmittedTitle>
          <DocumentReader document={submitted.document} />
        </DocumentEditing.Submitted>
      )}
      {createdId ? (
        <DocumentEditing.Actions>
          <Link to="/materials/$materialId" params={{ materialId: createdId }} search={{}}>
            {t('DocumentOpenCopy')}
          </Link>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => client.setQueryData(creationKey, initial)}
          >
            {t('LibraryStartAnother')}
          </Button>
        </DocumentEditing.Actions>
      ) : (
        error && (
          <ErrorState
            title={t('ErrorStateTitle')}
            description={
              <>{t(error === 'rejected' ? 'DocumentCreateRejected' : 'DocumentCreateUncertain')}</>
            }
          />
        )
      )}
      {error === 'uncertain' && !createdId && (
        <CreationLibraryReview
          busy={busy}
          onResolve={() => {
            client.setQueryData<Creation>(creationKey, (old) =>
              old && !old.busy && !old.createdId && old.error === 'uncertain'
                ? { ...old, error: undefined, submitted: undefined }
                : old
            );
          }}
        />
      )}
    </>
  );
}
