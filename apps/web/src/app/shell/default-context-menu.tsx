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

import { useNewBlankDocument } from '#web/features/authored-documents/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';

const destinations = [
  ['/sessions', 'Sessions', MessagesSquare],
  ['/documents', 'SourceDocument', FileText],
  ['/practice', 'Practice', GraduationCap]
] as const;

const globalDestinations = [
  ['/projects', 'Projects', FolderOpen],
  ['/settings', 'Settings', Settings],
  ['/help', 'Help', HelpCircle]
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
  const document = useNewBlankDocument(project);
  const search = project ? { project: String(project) } : {};

  async function createDocument() {
    if (!(await document.create())) {
      toastManager.add({ type: 'error', title: t('SessionActionErrorTitle') });
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="h-full"
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
          onClick={() => void navigate({ to: '/sessions', search })}
        >
          <SquarePen aria-hidden="true" />
          {t('NewSession')}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={disabled || document.pending}
          onClick={() => void createDocument()}
        >
          <FilePlus2 aria-hidden="true" />
          {t('DocumentNew')}
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
      </ContextMenuPopup>
    </ContextMenu>
  );
}
