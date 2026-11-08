import type { comparisonSchema, restoreSchema } from '@study/contracts/pages/editing';
import { Button } from '@study/ui/button';
import { Disclosure } from '@study/ui/disclosure';
import { DocumentEditing } from '@study/ui/document-editing';
import { ErrorState } from '@study/ui/error-state';
import { StatusMessage } from '@study/ui/status-message';
import { Link } from '@tanstack/react-router';

import { useI18n } from '#web/lib/i18n.tsx';
import { invalidatePages } from '#web/lib/study-client/pages.queries.ts';
import { request } from '#web/lib/study-client/request.ts';

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
                  pageId: version.pageId,
                  expectedVersionId: version.id,
                  key: saveKey.current,
                  document: draft
                };

                setPendingSave(input);
                client.setQueryData([...draftKey, 'pending-save'], input);
                const result = await request((rpc) => rpc['pages.save'](input));

                setOutcome(result);
                await invalidatePages(client);
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
          {t(outcome.outcome === 'conflict' ? 'PageConflict' : 'PageSaved')}
        </StatusMessage>
      )}
      {outcome && (
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () =>
              setComparison(
                await request((rpc) =>
                  rpc['pages.compare']({
                    beforeVersionId: outcome.expectedVersionId,
                    proposedVersionId: outcome.submittedVersionId,
                    currentVersionId: outcome.currentVersionId
                  })
                )
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
              const input = client.getQueryData<typeof restoreSchema.Type>([
                ...draftKey,
                'undo-input'
              ]) ?? {
                pageId: version.pageId,
                expectedVersionId: outcome.submittedVersionId,
                restoreVersionId: version.id,
                key: crypto.randomUUID()
              };

              client.setQueryData([...draftKey, 'undo-input'], input);
              const result = await request((rpc) => rpc['pages.restore'](input));

              client.setQueryData([...draftKey, 'undo-outcome'], result);
              setUndoOutcome(result);
              await invalidatePages(client);
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
              const copy = await request((rpc) =>
                rpc['pages.create']({
                  title: t('PageCopyTitle'),
                  document: authoredCopy(draft),
                  createKey: 'draft-copy:' + view.saveKey.current,
                  inputs: view.version.inputs,
                  citations: view.version.citations
                })
              );

              setSavedCopy(String(copy.id));
              await invalidatePages(view.client);
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
