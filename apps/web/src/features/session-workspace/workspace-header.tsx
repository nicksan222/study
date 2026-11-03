import type { projectSchema } from '@study/contracts/projects/schemas';
import { Sidebar } from '@study/ui/sidebar';
import { WorkspaceSurface } from '@study/ui/workspace';
import type { ReactNode } from 'react';

import { useI18n } from '../../lib/i18n';
import { SubjectIdentity } from '../subjects';

/** Shows session identity and controls while keeping subject scope in navigation. */
export function WorkspaceHeader({
  owner,
  title,
  children
}: {
  owner: typeof projectSchema.Type | undefined;
  title: string | undefined;
  children?: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <Sidebar.Topbar
      parent={
        owner ? (
          <WorkspaceSurface.SubjectIdentity>
            <SubjectIdentity name={owner.name} icon={owner.icon} />
            <span>{owner.name}</span>
          </WorkspaceSurface.SubjectIdentity>
        ) : (
          t('AppName')
        )
      }
      title={title || t('SessionUntitled')}
    >
      {children}
    </Sidebar.Topbar>
  );
}
