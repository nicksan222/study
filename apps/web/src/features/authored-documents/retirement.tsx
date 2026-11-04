import type { StudyDocument } from '@study/contracts/documents/types';
import { Button } from '@study/ui/button';
import { DangerDialog } from '@study/ui/danger-dialog';
import { Input } from '@study/ui/input';

import { useI18n } from '#web/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation/read-error';
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
function RetirementDialog({ view }: { view: View }) {
  const { t } = useI18n();
  const { document, mode, setMode, preview, retire, validKeep } = view;
  const blocked = !preview || preview.blockedVersionIds.length > 0;
  return (
    <DangerDialog
      open={mode !== undefined}
      onOpenChange={(open) => {
        if (!open) setMode(undefined);
      }}
      title={t(mode === 'history' ? 'DocumentPrune' : 'AuthoredDocumentDelete')}
      description={t('AuthoredDocumentRetirementHelp')}
      confirmLabel={t('AuthoredDocumentRetirementConfirm')}
      cancelLabel={t('Cancel')}
      pending={retire.isPending}
      disabled={blocked || (mode === 'history' && !validKeep)}
      confirmation={{
        identity: document.id + ':' + mode + ':' + (preview?.token ?? ''),
        value: document.title,
        label: t('DocumentTitle')
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
        disabled={view.retire.isPending || view.inspect.isPending}
        onChange={(event) => {
          view.setKeepLatest(event.target.value);
          view.setPreview(undefined);
        }}
      />
    </label>
  );
}
function RetirementFeedback({ view }: { view: View }) {
  const { t } = useI18n();
  const { preview, inspect, retire, mode, validKeep } = view;
  return (
    <>
      <Button
        variant="outline"
        disabled={inspect.isPending || retire.isPending || (mode === 'history' && !validKeep)}
        onClick={() => inspect.mutate()}
      >
        {t('DocumentPreview')}
      </Button>
      {preview && (
        <>
          <p>
            {t('ReaderHistory')}: {preview.versionIds.length}
          </p>
          <p>
            {t('DocumentProtectedVersions')} {preview.blockedVersionIds.length}
          </p>
        </>
      )}
      {inspect.error && <ContentReadError error={inspect.error} retry={() => inspect.mutate()} />}
      {retire.error && <ContentReadError error={retire.error} retry={() => inspect.mutate()} />}
    </>
  );
}
