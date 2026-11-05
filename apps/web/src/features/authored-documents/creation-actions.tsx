import type { ProjectId, StudyDocumentId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { useNavigate } from '@tanstack/react-router';
import { FilePlus2 } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { useBlankDocumentCreation } from '../session-workspace';

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
  const creation = useBlankDocumentCreation({ kind: 'project', projectId: project });
  const navigate = useNavigate();
  const [created, setCreated] = useState<StudyDocumentId>();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  async function create() {
    if (opening) return;

    setOpening(true);
    setFailed(false);

    try {
      const id = created ?? (await creation.create(t('SessionNewPage')))?.id;

      if (id === undefined) return;

      setCreated(id);
      await navigate({
        to: '/documents/$documentId',
        params: { documentId: String(id) },
        search: { project: project?.toString() }
      });
    } catch {
      setFailed(true);
    } finally {
      setOpening(false);
    }
  }

  return (
    <>
      <Button
        size={compact ? 'icon' : 'default'}
        variant={compact ? 'ghost-muted' : 'default'}
        aria-label={t(compact ? 'SessionCreateDocument' : 'DocumentNew')}
        title={t(compact ? 'SessionCreateDocument' : 'DocumentNew')}
        disabled={disabled || opening || creation.pending}
        onClick={() => void create()}
      >
        <FilePlus2 aria-hidden="true" />
        {!compact && t('DocumentNew')}
      </Button>
      {(creation.error !== undefined || failed) && (
        <ErrorState
          title={t('SessionActionErrorTitle')}
          action={
            <Button variant="ghost" onClick={() => void create()}>
              {t('Retry')}
            </Button>
          }
        />
      )}
    </>
  );
}
