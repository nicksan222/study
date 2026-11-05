import type { StudyDocument, StudyDocumentVersion } from '@study/contracts/documents/types';
import { Button } from '@study/ui/button';

import { useI18n } from '#web/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import { useMakeDocumentCurrent } from './make-document-current.queries';

export function MakeDocumentCurrent({
  document,
  version,
  disabled,
  onRestored,
  onBusy
}: {
  document: StudyDocument;
  version: StudyDocumentVersion;
  disabled: boolean;
  onRestored: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const mutation = useMakeDocumentCurrent({ document, version, onRestored, onBusy });

  return (
    <>
      <Button
        variant="ghost-muted"
        size="sm"
        disabled={
          disabled ||
          mutation.isPending ||
          mutation.isError ||
          mutation.data?.outcome === 'conflict'
        }
        onClick={() => mutation.mutate()}
      >
        {t('DocumentMakeCurrent')}
      </Button>
      {mutation.data?.outcome === 'conflict' && <span role="status">{t('DocumentConflict')}</span>}
      {mutation.error && (
        <ContentReadError error={mutation.error} retry={() => mutation.mutate()} />
      )}
    </>
  );
}
