import type { Project } from '@study/contracts';
import { Sidebar, WorkspaceCard, WorkspaceSurface, useWorkspaceWide } from '@study/ui';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { SubjectIdentity } from '#client/features/subjects/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';

/** Follows available layout width until the learner explicitly toggles the context panel. */
export function PracticeWorkspace({
  title,
  parent,
  actions,
  children
}: {
  title: string;
  parent?: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const workspace = useRef<HTMLDivElement>(null);
  const contextPanel = useRef<HTMLElement>(null);
  const contextToggle = useRef<HTMLButtonElement>(null);
  const [openOverride, setOpenOverride] = useState<boolean>();
  const wide = useWorkspaceWide(workspace, () => {
    if (openOverride === undefined && contextPanel.current?.contains(document.activeElement))
      contextToggle.current?.focus();
  });

  return (
    <WorkspaceCard.Provider
      open={openOverride ?? wide}
      triggerRef={contextToggle}
      onOpenChange={setOpenOverride}
    >
      <WorkspaceSurface.Root ref={workspace} variant="page">
        <Sidebar.Topbar parent={parent ?? t('AppName')} title={title}>
          <WorkspaceCard.Toggle label={t('PracticeActions')} />
        </Sidebar.Topbar>
        <WorkspaceSurface.Content>
          <WorkspaceCard.Root ref={contextPanel} aria-label={t('PracticeActions')}>
            <WorkspaceCard.Heading>{t('PracticeActions')}</WorkspaceCard.Heading>
            {actions}
          </WorkspaceCard.Root>
          <WorkspaceSurface.Body>{children}</WorkspaceSurface.Body>
        </WorkspaceSurface.Content>
      </WorkspaceSurface.Root>
    </WorkspaceCard.Provider>
  );
}

export function PracticeSubject({ project }: { project: Project }) {
  return (
    <WorkspaceSurface.SubjectIdentity>
      <SubjectIdentity name={project.name} icon={project.icon} />
      <span>{project.name}</span>
    </WorkspaceSurface.SubjectIdentity>
  );
}
