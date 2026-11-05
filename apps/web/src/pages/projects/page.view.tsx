import type { ProjectId } from '@study/contracts/ids';
import { SubjectWorkspace } from '@study/ui/subject-workspace';
import { PanelLeft } from 'lucide-react';

import { SubjectPage } from '#web/features/collections/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';

export function PageView({ project }: { project?: ProjectId }) {
  const { t } = useI18n();

  if (project) return <SubjectPage key={String(project)} project={project} />;

  return (
    <SubjectWorkspace.Empty>
      <SubjectWorkspace.EmptyContent>
        <SubjectWorkspace.EmptyIcon>
          <PanelLeft size={28} strokeWidth={1.5} aria-hidden="true" />
        </SubjectWorkspace.EmptyIcon>
        <SubjectWorkspace.EmptyTitle>{t('SubjectWorkspaceSelect')}</SubjectWorkspace.EmptyTitle>
        <SubjectWorkspace.EmptyDescription>
          {t('SubjectWorkspaceSelectHelp')}
        </SubjectWorkspace.EmptyDescription>
      </SubjectWorkspace.EmptyContent>
    </SubjectWorkspace.Empty>
  );
}
