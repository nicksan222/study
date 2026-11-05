import type { StudyDocument } from '@study/contracts/documents/types';
import { Button } from '@study/ui/button';
import { DangerDialog, DangerDialogSummary } from '@study/ui/danger-dialog';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';

import { useI18n } from '#web/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import { useDocumentRetirement } from './retirement.queries';

type View = ReturnType<typeof useDocumentRetirement>;

export function DocumentRetirement({ document }: { document: StudyDocument }) {
  const { t } = useI18n();
  const view = useDocumentRetirement(document);

  return (
    <>
      <Button variant="ghost" onClick={() => view.open('history')}>
        {t('DocumentPrune')}
      </Button>
      <Button variant="destructive-outline" onClick={() => view.open('deletion')}>
        {t('AuthoredDocumentDelete')}
      </Button>
      <RetirementDialog view={view} />
    </>
  );
}

export function DocumentDeletionDialog({
  document,
  onClose
}: {
  document: StudyDocument;
  onClose: () => void;
}) {
  const view = useDocumentRetirement(document, 'deletion', onClose);

  return <RetirementDialog view={view} onClose={onClose} />;
}

function RetirementDialog({ view, onClose }: { view: View; onClose?: () => void }) {
  const { t } = useI18n();
  const { document, mode, setMode, preview, retire, validKeep } = view;
  const blocked = !preview || preview.blockedVersionIds.length > 0;

  return (
    <DangerDialog
      open={mode !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          setMode(undefined);
          onClose?.();
        }
      }}
      title={t(mode === 'history' ? 'DocumentPrune' : 'AuthoredDocumentDelete')}
      description={t('AuthoredDocumentRetirementHelp')}
      confirmLabel={t('AuthoredDocumentRetirementConfirm')}
      cancelLabel={t('Cancel')}
      pending={retire.isPending}
      disabled={blocked || retire.isError || (mode === 'history' && !validKeep)}
      confirmation={{
        identity: document.id + ':' + mode + ':' + (preview?.token ?? ''),
        value: document.title,
        label: t('DeleteConfirmationInstruction', { word: document.title })
      }}
      onConfirm={() => retire.mutate()}
    >
      <HistorySettings view={view} />
      <RetirementFeedback view={view} />
    </DangerDialog>
  );
}

function HistorySettings({ view }: { view: View }) {
  const { t } = useI18n();

  if (view.mode !== 'history') return null;

  return (
    <label>
      {t('DocumentKeepLatest')}
      <Input
        type="number"
        min={1}
        max={1000}
        value={view.keepLatest}
        disabled={view.retire.isPending || view.inspect.isFetching}
        onChange={(event) => {
          view.setKeepLatest(event.target.value);
        }}
      />
    </label>
  );
}

function RetirementFeedback({ view }: { view: View }) {
  const { t } = useI18n();
  const { preview, inspect, retire } = view;

  return (
    <>
      {inspect.isFetching && <Loading label={t('LoadingStudy')} />}
      {preview && (
        <DangerDialogSummary
          items={[
            { label: t('AuthoredDocumentVersionsToRemove'), value: preview.versionIds.length },
            { label: t('DocumentProtectedVersions'), value: preview.blockedVersionIds.length }
          ]}
        />
      )}
      {inspect.error && (
        <ContentReadError error={inspect.error} retry={() => void inspect.refetch()} />
      )}
      {retire.error && (
        <ContentReadError
          error={retire.error}
          retry={() => {
            retire.reset();
            void inspect.refetch();
          }}
        />
      )}
    </>
  );
}
