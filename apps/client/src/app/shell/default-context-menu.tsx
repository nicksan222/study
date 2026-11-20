import type { ProjectId } from '@study/contracts';
import {
  CreatePageIcon,
  PageIcon,
  OpenProjectIcon,
  QuizIcon,
  HelpIcon,
  SettingsIcon,
  CreateNoteIcon
} from '@study/icons';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSeparator,
  toastManager
} from '@study/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useContext } from 'react';

import { ReplayContext } from '#client/features/onboarding/index.tsx';
import { useNewBlankPage } from '#client/features/pages/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';

const destinations = [
  ['/notes', 'Documents', PageIcon],
  ['/practice', 'Practice', QuizIcon]
] as const;

const globalDestinations = [
  ['/projects', 'Projects', OpenProjectIcon],
  ['/settings', 'Settings', SettingsIcon]
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
          onClick={() => void navigate({ to: '/notes', search: { ...search, notebookDraft: '1' } })}
        >
          <CreateNoteIcon aria-hidden="true" />
          {t('NewNote')}
        </ContextMenuItem>
        <ContextMenuItem disabled={disabled || page.pending} onClick={() => void createPage()}>
          <CreatePageIcon aria-hidden="true" />
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
        <ContextMenuItem disabled={!replay} onClick={() => replay?.()}>
          <HelpIcon aria-hidden="true" />
          {t('Help')}
        </ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
}
