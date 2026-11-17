import type { comparisonSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Button, Disclosure, DocumentEditing, ErrorState, StatusMessage } from '@study/ui';
import { Link } from '@tanstack/react-router';

import { useI18n } from '#client/lib/i18n.tsx';

import { DocumentReader } from '../document-presentation';
import { BlockEditor, authoredCopy } from './block-editor';
import { usePageEditor } from './document-editing.queries';

type Comparison = typeof comparisonSchema.Type;

export function ComparisonView({ value }: { value: Comparison }) {
  const { t } = useI18n();

  return (
    <DocumentEditing.Comparison>
      <p>{t('PageStructuralOnly')}</p>
      {(['before', 'proposed', 'current'] as const).map((kind) => (
        <Disclosure
          key={kind}
          summary={
            <>
              {t(
                kind === 'before'
                  ? 'PageBefore'
                  : kind === 'proposed'
                    ? 'PageSubmitted'
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

type PageEditor = ReturnType<typeof usePageEditor>;

export function PageActions(props: Parameters<typeof usePageEditor>[0]) {
  const view = usePageEditor(props);
  const { t, document } = view;

  if (!document) return null;

  return (
    <DocumentEditing.Editor>
      <h2>{t('PageEditing')}</h2>
      <PageEditEntry view={view} />
      <PageDraft view={view} />
      <PageSavedActions view={view} />
      <PageCopyStatus view={view} />
    </DocumentEditing.Editor>
  );
}

function PageEditEntry({ view }: { view: PageEditor }) {
  const { t, document, version, current, draft, change } = view;

  if (!document) return null;

  return (
    <>
      {version.id === current && !draft && (
        <Button onClick={() => change(structuredClone(document))}>{t('PageEdit')}</Button>
      )}
    </>
  );
}

function PageDraft({ view }: { view: PageEditor }) {
  const {
    t,
    document,
    version,
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
            targetKey={`${version.pageId}:${version.id}`}
            document={draft}
            change={change}
            disabled={busy || !!outcome || !!pendingSave}
          />
          <Button
            disabled={busy || !!outcome}
            onClick={() =>
              void run(async () => {
                const input = pendingSave ?? {
                  pageId: version.pageId,
                  expectedVersionId: version.id,
                  key: saveKey.current,
                  document: draft
                };

                setPendingSave(input);
                const result = await rpc.pages.save.call(input);

                setOutcome(result);
              })
            }
          >
            {t('PageSave')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={discard}>
            {t('PageCloseDraft')}
          </Button>
        </>
      )}
    </>
  );
}

function PageSavedActions({ view }: { view: PageEditor }) {
  const {
    t,
    version,
    busy,
    outcome,
    setComparison,
    undoOutcome,
    undoInput,
    setUndoInput,
    setUndoOutcome,
    run
  } = view;

  return (
    <>
      {outcome && (
        <StatusMessage>
          {t(outcome.outcome === 'conflict' ? 'PageConflict' : 'PageSaved')}
        </StatusMessage>
      )}
      {outcome && (
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () =>
              setComparison(
                await rpc.pages.compare.read({
                  beforeVersionId: outcome.expectedVersionId,
                  proposedVersionId: outcome.submittedVersionId,
                  currentVersionId: outcome.currentVersionId
                })
              )
            )
          }
        >
          {t('PageCompare')}
        </Button>
      )}
      {outcome?.outcome === 'saved' && !undoOutcome && (
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const input = undoInput ?? {
                pageId: version.pageId,
                expectedVersionId: outcome.submittedVersionId,
                restoreVersionId: version.id,
                key: crypto.randomUUID()
              };

              setUndoInput(input);
              const result = await rpc.pages.restore.call(input);

              setUndoOutcome(result);
            })
          }
        >
          {t('PageUndo')}
        </Button>
      )}
      {undoOutcome && (
        <StatusMessage>
          {t(undoOutcome.outcome === 'saved' ? 'PageUndone' : 'PageUndoConflict')}
        </StatusMessage>
      )}
    </>
  );
}

function PageCopyStatus({ view }: { view: PageEditor }) {
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
              const copy = await rpc.pages.create.call({
                title: t('PageCopyTitle'),
                document: authoredCopy(draft),
                createKey: 'draft-copy:' + view.saveKey.current,
                inputs: view.version.inputs,
                citations: view.version.citations
              });

              setSavedCopy(String(copy.id));
            })
          }
        >
          {t('PageKeepDraftCopy')}
        </Button>
      )}
      {comparison && <ComparisonView value={comparison} />}
      {savedCopy && (
        <Link to="/pages/$pageId" params={{ pageId: savedCopy }} search={{}}>
          {t('PageOpenCopy')}
        </Link>
      )}
      {error && (
        <ErrorState title={t('ErrorStateTitle')} description={<> {t('PageActionFailed')} </>} />
      )}
    </>
  );
}
