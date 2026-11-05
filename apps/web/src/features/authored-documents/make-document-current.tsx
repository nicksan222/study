import type { StudyDocument, StudyDocumentVersion } from '@study/contracts/documents/types';
import { Button } from '@study/ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { invalidateDocuments } from '#web/lib/study-client/documents.queries.ts';

import { ContentReadError } from '../document-presentation';
import { restoreDocumentOptions } from './restore.queries';

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
  const cache = useQueryClient();
  const attemptKey = ['document-restore-attempt', String(document.id), String(version.id)];

  const mutation = useMutation({
    ...restoreDocumentOptions(cache, document, version),
    onSuccess: async (outcome) => {
      cache.removeQueries({ queryKey: attemptKey, exact: true });
      await invalidateDocuments(cache);

      if (outcome.outcome === 'saved') onRestored();
    }
  });

  useEffect(() => {
    onBusy(mutation.isPending || mutation.isError);

    return () => onBusy(false);
  }, [onBusy, mutation.isPending, mutation.isError]);

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
