import type { ProjectId } from '@study/contracts';

import { PracticeStudyNotes } from '#client/features/pages/index.ts';

export function PageView({ project }: { project?: ProjectId }) {
  return <PracticeStudyNotes key={String(project)} project={project} />;
}
