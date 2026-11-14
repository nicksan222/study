import type { MaterialSummaryDto } from '@study/contracts/materials/schemas';
import { ArchiveIcon, OpenIcon, PageIcon, HistoryIcon } from '@study/icons';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSeparator
} from '@study/ui/context-menu';
import { toastManager } from '@study/ui/toast';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { AttemptsDialog } from './history-dialog';
import { useMaterialArchive } from './practice.queries';

/** Shares the practice destinations and archive operation with the workspace actions. */
export function PracticeSidebarContextMenu({
  material,
  project,
  active,
  children
}: {
  material: MaterialSummaryDto;
  project?: string;
  active: boolean;
  children: ReactElement;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [history, setHistory] = useState(false);
  const archive = useMaterialArchive(material.id, false);
  const search =
    (project ?? material.projectIds[0]?.toString())
      ? { project: project ?? material.projectIds[0]?.toString() }
      : {};
  const destination =
    material.kind === 'flashcards' ? '/flashcards/$materialId' : '/practice/$materialId';
  const params = { materialId: String(material.id) };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={children} />
        <ContextMenuPopup>
          <ContextMenuItem render={<Link to={destination} params={params} search={search} />}>
            <OpenIcon aria-hidden="true" />
            {t('OpenPractice')}
          </ContextMenuItem>
          <ContextMenuItem
            render={<Link to="/materials/$materialId" params={params} search={search} />}
          >
            <PageIcon aria-hidden="true" />
            {t('PracticeViewMaterial')}
          </ContextMenuItem>
          {material.kind === 'quiz' && (
            <ContextMenuItem onClick={() => setHistory(true)}>
              <HistoryIcon aria-hidden="true" />
              {t('PracticeAttempts')}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={archive.isPending}
            onClick={() =>
              archive.mutate(undefined, {
                onSuccess: () => {
                  if (active) void navigate({ to: '/practice', search });
                },
                onError: () => toastManager.add({ title: t('PracticeArchiveError'), type: 'error' })
              })
            }
          >
            <ArchiveIcon aria-hidden="true" />
            {t('PracticeArchiveMaterial')}
          </ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
      {history && <AttemptsDialog id={material.id} open onOpenChange={setHistory} />}
    </>
  );
}
