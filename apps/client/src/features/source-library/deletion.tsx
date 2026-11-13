import type { Source } from '@study/contracts/sources/schemas';
import { Button } from '@study/ui/button';
import { DangerDialog } from '@study/ui/danger-dialog';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { useSourceDeletion } from './deletion.queries';

export function SourceDeletion({
  source,
  onDeleted,
  renderTrigger
}: {
  source: Source;
  onDeleted: () => void;
  renderTrigger?: (show: () => void, open: boolean) => ReactNode;
}) {
  const { t } = useI18n();
  const view = useSourceDeletion(source, onDeleted);
  const blocked =
    !view.preview.data || view.preview.isError || view.preview.data.blockedBy.length > 0;

  return (
    <>
      {renderTrigger ? (
        renderTrigger(view.show, view.open)
      ) : (
        <Button variant="destructive-outline" onClick={view.show}>
          {t('SourceDeleteTitle')}
        </Button>
      )}
      <DangerDialog
        open={view.open}
        onOpenChange={view.setOpen}
        title={t('SourceDeleteTitle')}
        description={t('SourceDeleteHelp')}
        confirmLabel={t('SourceDeleteConfirm')}
        cancelLabel={t('Cancel')}
        pending={view.remove.isPending}
        disabled={blocked || view.preview.isFetching}
        confirmation={{
          identity: String(source.id),
          value: source.name,
          label: t('SourceDeleteName')
        }}
        onConfirm={() => view.remove.mutate()}
      >
        {view.preview.isFetching && <Loading label={t('LoadingStudy')} />}
        {view.preview.data && (
          <>
            <p>
              {t('SourceDeleteRevisions')}: {String(view.preview.data.revisionCount)}
            </p>
            <p>
              {t('SourceDeleteExtractions')}: {String(view.preview.data.extractionCount)}
            </p>
            {view.preview.data.blockedBy.map((reason) => (
              <p key={reason}>
                {t(reason === 'exact_inputs' ? 'SourceDeleteExactPins' : 'SourceDeleteImagePins')}
              </p>
            ))}
          </>
        )}
        {(view.preview.error || view.remove.error) && (
          <ErrorState
            title={t('SourceDeleteFailed')}
            action={<Button onClick={() => void view.preview.refetch()}>{t('PagePreview')}</Button>}
          />
        )}
      </DangerDialog>
    </>
  );
}
