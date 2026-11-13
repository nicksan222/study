import type { Project } from '@study/contracts/projects/schemas';
import { Sidebar } from '@study/ui/sidebar';
import { WorkspaceCard, WorkspaceSurface } from '@study/ui/workspace';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { SubjectIdentity } from '#client/features/subjects/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';

/** Initializes the context panel from its available layout width before paint, then preserves manual toggles. */
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
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    setOpen((workspace.current?.parentElement?.clientWidth ?? 0) >= 960);
  }, []);

  return (
    <WorkspaceCard.Provider open={open} onOpenChange={setOpen}>
      <WorkspaceSurface.Root ref={workspace} variant="practice">
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
