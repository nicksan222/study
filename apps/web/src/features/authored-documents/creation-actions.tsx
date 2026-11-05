import type { ProjectId, StudyDocumentId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { useNavigate } from '@tanstack/react-router';
import { FilePlus2 } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { useBlankDocumentCreation } from '../session-workspace';

/** Keeps document creation receipts and navigation retries shared across entry points. */
export function useNewBlankDocument(project?: ProjectId) {
  const { t } = useI18n();
  const creation = useBlankDocumentCreation({ kind: 'project', projectId: project });
  const navigate = useNavigate();
  const [created, setCreated] = useState<{ id: StudyDocumentId; project?: ProjectId }>();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  async function create() {
    if (opening || creation.pending) return false;

    setOpening(true);
    setFailed(false);

    try {
      const retained = created?.project === project ? created?.id : undefined;
      const id = retained ?? (await creation.create(t('SessionNewPage')))?.id;

      if (id === undefined) return false;

      setCreated({ id, project });
      await navigate({
        to: '/documents/$documentId',
        params: { documentId: String(id) },
        search: { project: project?.toString() }
      });

      setCreated(undefined);

      return true;
    } catch {
      setFailed(true);

      return false;
    } finally {
      setOpening(false);
    }
  }

  return {
    create,
    pending: opening || creation.pending,
    error: creation.error !== undefined || failed
  };
}

/** Creates the same blank document used in a session, then opens the shared editor. */
export function NewBlankDocument({
  project,
  compact = false,
  disabled = false
}: {
  project?: ProjectId;
  compact?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const creation = useNewBlankDocument(project);

  return (
    <>
      <Button
        size={compact ? 'icon' : 'default'}
        variant={compact ? 'ghost-muted' : 'default'}
        aria-label={t(compact ? 'SessionCreateDocument' : 'DocumentNew')}
        title={t(compact ? 'SessionCreateDocument' : 'DocumentNew')}
        disabled={disabled || creation.pending}
        onClick={() => void creation.create()}
      >
        <FilePlus2 aria-hidden="true" />
        {!compact && t('DocumentNew')}
      </Button>
      {creation.error && (
        <ErrorState
          title={t('SessionActionErrorTitle')}
          action={
            <Button variant="ghost" onClick={() => void creation.create()}>
              {t('Retry')}
            </Button>
          }
        />
      )}
    </>
  );
}
