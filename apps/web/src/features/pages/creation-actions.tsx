import type { ProjectId, PageId } from '@study/contracts/ids';
import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { useNavigate } from '@tanstack/react-router';
import { FilePlus2 } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { useBlankPageCreation } from '../note-workspace';

/** Keeps page creation receipts and navigation retries shared across entry points. */
export function useNewBlankPage(project?: ProjectId) {
  const { t } = useI18n();
  const creation = useBlankPageCreation({ kind: 'project', projectId: project });
  const navigate = useNavigate();
  const [created, setCreated] = useState<{ id: PageId; project?: ProjectId }>();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  async function create() {
    if (opening || creation.pending) return false;

    setOpening(true);
    setFailed(false);

    try {
      const retained = created?.project === project ? created?.id : undefined;
      const id = retained ?? (await creation.create(t('NoteNewPage')))?.id;

      if (id === undefined) return false;

      setCreated({ id, project });
      await navigate({
        to: '/pages/$pageId',
        params: { pageId: String(id) },
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

/** Creates the same blank document used in a note, then opens the shared editor. */
export function NewBlankPage({
  project,
  compact = false,
  disabled = false
}: {
  project?: ProjectId;
  compact?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const creation = useNewBlankPage(project);

  return (
    <>
      <Button
        size={compact ? 'icon' : 'default'}
        variant={compact ? 'ghost-muted' : 'default'}
        aria-label={t(compact ? 'NoteCreatePage' : 'PageNew')}
        title={t(compact ? 'NoteCreatePage' : 'PageNew')}
        disabled={disabled || creation.pending}
        onClick={() => void creation.create()}
      >
        <FilePlus2 aria-hidden="true" />
        {!compact && t('PageNew')}
      </Button>
      {creation.error && (
        <ErrorState
          title={t('NoteActionErrorTitle')}
          action={
            <RetryButton
              variant="ghost"
              onClick={() => void creation.create()}
              label={t('Retry')}
            />
          }
        />
      )}
    </>
  );
}
