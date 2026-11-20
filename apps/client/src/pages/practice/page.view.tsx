import type { ProjectId } from '@study/contracts';

import { PageMerges } from '#client/features/pages/index.ts';

export function PageView({ project }: { project?: ProjectId }) {
  return project ? <PageMerges project={project} studyNotes /> : null;
}
