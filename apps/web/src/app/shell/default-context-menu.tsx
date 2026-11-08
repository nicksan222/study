import type { ProjectId } from '@study/contracts/ids';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSeparator
} from '@study/ui/context-menu';
import { toastManager } from '@study/ui/toast';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  FilePlus2,
  FileText,
  FolderOpen,
  GraduationCap,
  HelpCircle,
  MessagesSquare,
  Settings,
  SquarePen
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useContext } from 'react';

import { ReplayContext } from '#web/features/onboarding/index.tsx';
import { useNewBlankPage } from '#web/features/pages/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';

const destinations = [
  ['/notes', 'Notes', MessagesSquare],
  ['/pages', 'SourcePage', FileText],
  ['/practice', 'Practice', GraduationCap]
] as const;

const globalDestinations = [
  ['/projects', 'Projects', FolderOpen],
  ['/settings', 'Settings', Settings]
] as const;

/** Provides workspace shortcuts wherever a descendant has not handled its own context menu. */
export function DefaultContextMenu({
  project,
  disabled = false,
  children
}: {
  project?: ProjectId;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const replay = useContext(ReplayContext);
  const page = useNewBlankPage(project);
  const search = project ? { project: String(project) } : {};

  async function createPage() {
    if (!(await page.create())) {
      toastManager.add({ type: 'error', title: t('NoteActionErrorTitle') });
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        fill
        tabIndex={-1}
        onContextMenu={(event) => {
          if (event.defaultPrevented) event.preventBaseUIHandler();
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuPopup aria-label={t('WorkspaceShortcuts')}>
        <ContextMenuItem
          disabled={disabled}
          onClick={() => void navigate({ to: '/notes', search })}
        >
          <SquarePen aria-hidden="true" />
          {t('NewNote')}
        </ContextMenuItem>
        <ContextMenuItem disabled={disabled || page.pending} onClick={() => void createPage()}>
          <FilePlus2 aria-hidden="true" />
          {t('PageNew')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {destinations.map(([to, label, Icon]) => (
          <ContextMenuItem key={to} disabled={disabled} render={<Link to={to} search={search} />}>
            <Icon aria-hidden="true" />
            {t(label)}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        {globalDestinations.map(([to, label, Icon]) => (
          <ContextMenuItem key={to} render={<Link to={to} search={{}} />}>
            <Icon aria-hidden="true" />
            {t(label)}
          </ContextMenuItem>
        ))}
        <ContextMenuItem disabled={!replay} onClick={() => replay?.()}>
          <HelpCircle aria-hidden="true" />
          {t('Help')}
        </ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
}
