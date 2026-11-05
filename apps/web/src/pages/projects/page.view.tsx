import type { ProjectId } from '@study/contracts/ids';

import { SubjectPage } from '#web/features/collections/index.ts';

export function PageView({ project }: { project?: ProjectId }) {
  return project ? <SubjectPage key={String(project)} project={project} /> : null;
}
