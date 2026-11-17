import type { Source } from '@study/contracts';
import { Button, DangerDialog, ErrorState, Field, Input, Loading, StatusMessage } from '@study/ui';
import type { ReactNode } from 'react';

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
  onRetired,
  renderTrigger
}: {
  source: Source;
  onRetired: () => void;
  renderTrigger?: (show: () => void) => ReactNode;
}) {
  const { t } = useI18n();
  const view = useSourceHistoryRetirement(source.id, onRetired);
  const preview = view.preview;
  const disabled = removalDisabled(view);

  return (
    <>
      {renderTrigger ? (
        renderTrigger(view.show)
      ) : (
        <Button variant="ghost" onClick={view.show}>
          {t('SourceHistoryPrune')}
        </Button>
      )}
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
