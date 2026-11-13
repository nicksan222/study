import type { Source } from '@study/contracts/sources/schemas';
import { Button } from '@study/ui/button';
import { DangerDialog } from '@study/ui/danger-dialog';
import { ErrorState } from '@study/ui/error-state';
import { Field } from '@study/ui/field';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { StatusMessage } from '@study/ui/status-message';

import { useI18n } from '#client/lib/i18n.tsx';

import { useSourceHistoryRetirement } from './history-retirement.queries';

type View = ReturnType<typeof useSourceHistoryRetirement>;

function HistoryReview({ view }: { view: View }) {
  const { t } = useI18n();
  const value = view.preview.data;

  if (view.preview.isFetching) return <Loading label={t('LoadingStudy')} />;

  return (
    <>
      {value && (
        <p>
          {t('SourceHistoryCount')}: {value.candidates.length}
        </p>
      )}
      {value?.blockedSnapshotIds.length ? <p>{t('SourceHistoryPinned')}</p> : null}
      {value?.candidates.length === 0 && <p>{t('SourceHistoryEmpty')}</p>}
      {(view.preview.error || view.remove.error || view.recover.error) && (
        <ErrorState
          title={t('SourceHistoryFailed')}
          action={
            <Button disabled={view.pending} onClick={view.reviewAgain}>
              {t('PagePreview')}
            </Button>
          }
        />
      )}
      {view.state.attempt && (
        <Button disabled={view.pending} onClick={() => view.recover.mutate()}>
          {t('SourceHistoryRecover')}
        </Button>
      )}
    </>
  );
}

function removalDisabled(view: View) {
  const preview = view.preview;

  return (
    !view.valid ||
    !!view.state.attempt ||
    preview.isFetching ||
    preview.isError ||
    !preview.data?.candidates.length ||
    !!preview.data?.blockedSnapshotIds.length
  );
}

export function SourceHistoryRetirement({
  source,
  onRetired
}: {
  source: Source;
  onRetired: () => void;
}) {
  const { t } = useI18n();
  const view = useSourceHistoryRetirement(source.id, onRetired);
  const preview = view.preview;
  const disabled = removalDisabled(view);

  return (
    <>
      <Button variant="ghost" onClick={view.show}>
        {t('SourceHistoryPrune')}
      </Button>
      {view.state.notice && (
        <StatusMessage>
          {t(view.state.notice === 'removed' ? 'SourceHistoryRemoved' : 'SourceHistoryReconciled')}
        </StatusMessage>
      )}
      <DangerDialog
        open={view.open}
        onOpenChange={view.setOpen}
        title={t('SourceHistoryPrune')}
        description={t('SourceHistoryHelp')}
        confirmLabel={t('SourceHistoryConfirm')}
        cancelLabel={t('Cancel')}
        pending={view.pending}
        disabled={disabled}
        confirmation={{
          identity: `${source.id}:${preview.data?.token}`,
          value: preview.data?.name ?? source.name,
          label: t('SourceDeleteName')
        }}
        onConfirm={view.confirm}
      >
        <Field label={<> {t('SourceHistoryKeep')} </>}>
          <Input
            type="number"
            min={1}
            max={100}
            value={view.keep}
            disabled={view.pending || !!view.state.attempt}
            onChange={(event) => view.setKeep(event.target.value)}
          />
        </Field>
        <HistoryReview view={view} />
      </DangerDialog>
    </>
  );
}
