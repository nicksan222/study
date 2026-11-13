import type { Page } from '@study/contracts/pages/types';
import { DangerDialog, DangerDialogSummary } from '@study/ui/danger-dialog';
import { Field } from '@study/ui/field';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';

import { useI18n } from '#client/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import { usePageRetirement } from './retirement.queries';

type View = ReturnType<typeof usePageRetirement>;

export function PageDeletionDialog({ page, onClose }: { page: Page; onClose: () => void }) {
  const view = usePageRetirement(page, 'deletion', onClose);

  return <RetirementDialog view={view} onClose={onClose} />;
}

function RetirementDialog({ view, onClose }: { view: View; onClose?: () => void }) {
  const { t } = useI18n();
  const { page, mode, setMode, preview, retire, validKeep } = view;
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
      title={t(mode === 'history' ? 'PagePrune' : 'AuthoredPageDelete')}
      description={t('AuthoredPageRetirementHelp')}
      confirmLabel={t('AuthoredPageRetirementConfirm')}
      cancelLabel={t('Cancel')}
      pending={retire.isPending}
      disabled={blocked || retire.isError || (mode === 'history' && !validKeep)}
      confirmation={{
        identity: page.id + ':' + mode + ':' + (preview?.token ?? ''),
        value: page.title,
        label: t('DeleteConfirmationInstruction', { word: page.title })
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
    <Field label={<> {t('PageKeepLatest')} </>}>
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
    </Field>
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
            { label: t('AuthoredPageVersionsToRemove'), value: preview.versionIds.length },
            { label: t('PageProtectedVersions'), value: preview.blockedVersionIds.length }
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
