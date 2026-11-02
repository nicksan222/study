import type {
  createManualDocumentSchema,
  documentComparisonSchema,
  documentEditOutcomeSchema,
  saveDocumentInputSchema,
  undoDocumentInputSchema
} from '@study/contracts/materials/editing';
import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import { plainBlock } from '@study/contracts/sources/document';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { Button } from '@study/ui/button';
import { Dialog, DialogPopup, DialogHeader, DialogTitle } from '@study/ui/dialog';
import { ErrorState } from '@study/ui/error-state';
import { Input } from '@study/ui/input';
import { Textarea } from '@study/ui/textarea';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { request } from '../../lib/study-client/request';
import { DocumentReader } from '../material-library/document-reader';
import { BlockEditor, blankDocument, authoredCopy } from './block-editor';
import { CreationLibraryReview } from './creation-library-review';

type Comparison = typeof documentComparisonSchema.Type;
type Outcome = typeof documentEditOutcomeSchema.Type;
export function ComparisonView({ value }: { value: Comparison }) {
  const { t } = useI18n();
  return (
    <div className="document-comparison">
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
    </div>
  );
}
export function NewDocument() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const client = useQueryClient();
  type Creation = {
    title: string;
    text: string;
    busy: boolean;
    error?: 'rejected' | 'uncertain';
    createdId?: string;
    submitted?: typeof createManualDocumentSchema.Type;
  };
  const creationKey = ['document-creation'];
  const initial: Creation = { title: '', text: '', busy: false };
  const creation = useQuery<Creation>({
    queryKey: creationKey,
    initialData: initial,
    queryFn: () => initial,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const { title, text, busy, error, createdId, submitted } = creation.data;
  function change(next: Partial<Creation>) {
    client.setQueryData<Creation>(creationKey, (old) => ({ ...old!, ...next }));
  }
  const setTitle = (title: string) => change({ title });
  const setText = (text: string) => change({ text });
  const setBusy = (busy: boolean) => change({ busy });
  const setError = (error: Creation['error']) => change({ error });
  const setCreatedId = (createdId: string) => change({ createdId });
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
          <form
            className="library-import"
            onSubmit={async (event) => {
              event.preventDefault();
              const latest = client.getQueryData<Creation>(creationKey);
              if (
                latest?.busy ||
                latest?.createdId ||
                latest?.error === 'uncertain' ||
                error === 'uncertain' ||
                createdId ||
                !title.trim() ||
                !text.trim()
              )
                return;
              const input: typeof createManualDocumentSchema.Type = {
                title,
                document: {
                  ...blankDocument(),
                  blocks: [plainBlock('paragraph', text, { type: 'authored' })]
                }
              };
              change({ busy: true, error: undefined, submitted: input });
              try {
                const material = await request((rpc) =>
                  rpc['materials.createManualDocument'](input)
                );
                setCreatedId(String(material.id));
                await client.invalidateQueries({ queryKey: ['materials'] });
                await navigate({
                  to: '/materials/$materialId',
                  params: { materialId: String(material.id) },
                  search: {}
                });
              } catch (cause) {
                setError(toStudyError(cause).kind === 'invalid_input' ? 'rejected' : 'uncertain');
              } finally {
                setBusy(false);
              }
            }}
          >
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
            {submitted && (error === 'uncertain' || createdId) && (
              <section
                aria-label={t('DocumentCreationSubmitted')}
                className="space-y-2 rounded-md border border-border p-3"
              >
                <h3 className="text-sm font-medium">{t('DocumentCreationSubmitted')}</h3>
                <p className="font-medium">{submitted.title}</p>
                <DocumentReader document={submitted.document} />
              </section>
            )}
            {createdId ? (
              <div className="material-actions">
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
              </div>
            ) : (
              error && (
                <ErrorState
                  title={t('ErrorStateTitle')}
                  description={
                    <>
                      {t(
                        error === 'rejected' ? 'DocumentCreateRejected' : 'DocumentCreateUncertain'
                      )}
                    </>
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
          </form>
        </DialogPopup>
      </Dialog>
    </>
  );
}
export function DocumentActions({
  version,
  current
}: {
  version: MaterialVersionDetailDto;
  current: MaterialVersionDetailDto['id'];
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const content = version.content;
  const document =
    content.kind === 'document'
      ? content
      : 'extracted' in content
        ? content.extracted?.document
        : undefined;
  // User-authored drafts and exact retry receipts live until explicit discard.
  client.setQueryDefaults(['document-editor'], { gcTime: Infinity });
  const draftKey = ['document-editor', String(version.material_id), String(version.id)];
  const [draft, setDraft] = useState<typeof documentSchema.Type | undefined>(() =>
    client.getQueryData(draftKey)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [outcome, setOutcomeState] = useState<Outcome | undefined>(() =>
    client.getQueryData([...draftKey, 'outcome'])
  );
  function setOutcome(value: Outcome | undefined) {
    setOutcomeState(value);
    client.setQueryData([...draftKey, 'outcome'], value);
    if (!value) client.removeQueries({ queryKey: [...draftKey, 'outcome'], exact: true });
  }
  const [comparison, setComparison] = useState<Comparison>();
  const [savedCopy, setSavedCopy] = useState<string>();
  const saveKey = useRef(
    client.getQueryData<string>([...draftKey, 'save-key']) ?? crypto.randomUUID()
  );
  client.setQueryData([...draftKey, 'save-key'], saveKey.current);
  const [pendingSave, setPendingSave] = useState<typeof saveDocumentInputSchema.Type | undefined>(
    () => client.getQueryData([...draftKey, 'pending-save'])
  );
  const [undoOutcome, setUndoOutcome] = useState<Outcome | undefined>(() =>
    client.getQueryData([...draftKey, 'undo-outcome'])
  );
  const lock = useRef(false);
  function change(value: typeof documentSchema.Type) {
    setDraft(value);
    client.setQueryData(draftKey, value);
    saveKey.current = crypto.randomUUID();
    client.setQueryData([...draftKey, 'save-key'], saveKey.current);
    setOutcome(undefined);
    setComparison(undefined);
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch {
      setError(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!document) return null;
  return (
    <section className="reader-history document-writing">
      <h2>{t('DocumentEditing')}</h2>
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
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(undefined);
              client.removeQueries({ queryKey: draftKey });
              setOutcome(undefined);
              setPendingSave(undefined);
              setUndoOutcome(undefined);
              saveKey.current = crypto.randomUUID();
            }}
          >
            {t('DocumentCloseDraft')}
          </Button>
        </>
      )}
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
    </section>
  );
}
