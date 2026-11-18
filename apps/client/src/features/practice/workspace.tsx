import type { Project } from '@study/contracts';
import { Sidebar, WorkspaceCard, WorkspaceSurface } from '@study/ui';
import { useLayoutEffect, useRef, useState } from 'react';
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
  const [open, setOpen] = useState(false);
  const manuallyToggled = useRef(false);

  useLayoutEffect(() => {
    const container = workspace.current?.parentElement;

    if (!container) return;

    const measure = () => {
      if (!manuallyToggled.current) setOpen(container.clientWidth >= 960);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(measure);

    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  return (
    <WorkspaceCard.Provider
      open={open}
      onOpenChange={(nextOpen) => {
        manuallyToggled.current = true;
        setOpen(nextOpen);
      }}
    >
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
