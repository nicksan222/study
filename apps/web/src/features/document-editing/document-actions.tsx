import type { comparisonSchema, restoreSchema } from '@study/contracts/documents/editing';
import { Button } from '@study/ui/button';
import { Disclosure } from '@study/ui/disclosure';
import { DocumentEditing } from '@study/ui/document-editing';
import { ErrorState } from '@study/ui/error-state';
import { StatusMessage } from '@study/ui/status-message';
import { Link } from '@tanstack/react-router';

import { useI18n } from '#web/lib/i18n.tsx';
import { invalidateDocuments } from '#web/lib/study-client/documents.queries.ts';
import { request } from '#web/lib/study-client/request.ts';

import { DocumentReader } from '../document-presentation';
import { BlockEditor, authoredCopy } from './block-editor';
import { useDocumentEditor } from './document-editing.queries';

type Comparison = typeof comparisonSchema.Type;

export function ComparisonView({ value }: { value: Comparison }) {
  const { t } = useI18n();

  return (
    <DocumentEditing.Comparison>
      <p>{t('DocumentStructuralOnly')}</p>
      {(['before', 'proposed', 'current'] as const).map((kind) => (
        <Disclosure
          key={kind}
          summary={
            <>
              {t(
                kind === 'before'
                  ? 'DocumentBefore'
                  : kind === 'proposed'
                    ? 'DocumentSubmitted'
                    : 'ReaderCurrent'
              )}
            </>
          }
        >
          <DocumentReader document={value[kind].document} />
        </Disclosure>
      ))}
    </DocumentEditing.Comparison>
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
  const { t, document, version, current, draft, change } = view;

  if (!document) return null;

  return (
    <>
      {version.id === current && !draft && (
        <Button onClick={() => change(structuredClone(document))}>{t('DocumentEdit')}</Button>
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
                  documentId: version.documentId,
                  expectedVersionId: version.id,
                  key: saveKey.current,
                  document: draft
                };

                setPendingSave(input);
                client.setQueryData([...draftKey, 'pending-save'], input);
                const result = await request((rpc) => rpc['documents.save'](input));

                setOutcome(result);
                await invalidateDocuments(client);
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
        <StatusMessage>
          {t(outcome.outcome === 'conflict' ? 'DocumentConflict' : 'DocumentSaved')}
        </StatusMessage>
      )}
      {outcome && (
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () =>
              setComparison(
                await request((rpc) =>
                  rpc['documents.compare']({
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
              const input = client.getQueryData<typeof restoreSchema.Type>([
                ...draftKey,
                'undo-input'
              ]) ?? {
                documentId: version.documentId,
                expectedVersionId: outcome.submittedVersionId,
                restoreVersionId: version.id,
                key: crypto.randomUUID()
              };

              client.setQueryData([...draftKey, 'undo-input'], input);
              const result = await request((rpc) => rpc['documents.restore'](input));

              client.setQueryData([...draftKey, 'undo-outcome'], result);
              setUndoOutcome(result);
              await invalidateDocuments(client);
            })
          }
        >
          {t('DocumentUndo')}
        </Button>
      )}
      {undoOutcome && (
        <StatusMessage>
          {t(undoOutcome.outcome === 'saved' ? 'DocumentUndone' : 'DocumentUndoConflict')}
        </StatusMessage>
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
                rpc['documents.create']({
                  title: t('DocumentCopyTitle'),
                  document: authoredCopy(draft),
                  createKey: 'draft-copy:' + view.saveKey.current,
                  inputs: view.version.inputs,
                  citations: view.version.citations
                })
              );

              setSavedCopy(String(copy.id));
              await invalidateDocuments(view.client);
            })
          }
        >
          {t('DocumentKeepDraftCopy')}
        </Button>
      )}
      {comparison && <ComparisonView value={comparison} />}
      {savedCopy && (
        <Link to="/documents/$documentId" params={{ documentId: savedCopy }} search={{}}>
          {t('DocumentOpenCopy')}
        </Link>
      )}
      {error && (
        <ErrorState title={t('ErrorStateTitle')} description={<> {t('DocumentActionFailed')} </>} />
      )}
    </>
  );
}
