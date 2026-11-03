import type { projectSchema } from '@study/contracts/projects/schemas';
import { Sidebar } from '@study/ui/sidebar';
import type { ReactNode } from 'react';

import { useI18n } from '../../lib/i18n';
import { SubjectIdentity } from '../subjects/subject-identity';

export function WorkspaceHeader({
  owner,
  title,
  children
}: {
  owner: typeof projectSchema.Type | undefined;
  title: string | undefined;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Sidebar.Topbar
      parent={
        owner ? (
          <span className="session-subject-identity">
            <SubjectIdentity name={owner.name} icon={owner.icon} />
            <span>{owner.name}</span>
          </span>
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
