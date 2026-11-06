import type { Project } from '@study/contracts/projects/schemas';
import { Sidebar } from '@study/ui/sidebar';
import { WorkspaceCard, WorkspaceSurface } from '@study/ui/workspace';
import type { ReactNode } from 'react';

import { SubjectIdentity } from '#web/features/subjects/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';

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

  return (
    <WorkspaceCard.Provider defaultOpen={window.innerWidth >= 1100}>
      <WorkspaceSurface.Root variant="practice">
        <Sidebar.Topbar parent={parent ?? t('AppName')} title={title}>
          <WorkspaceCard.Toggle label={t('PracticeActions')} />
        </Sidebar.Topbar>
        <WorkspaceSurface.Body>{children}</WorkspaceSurface.Body>
        <WorkspaceCard.Root aria-label={t('PracticeActions')}>{actions}</WorkspaceCard.Root>
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
