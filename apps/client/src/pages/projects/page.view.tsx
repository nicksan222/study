import type { ProjectId } from '@study/contracts/ids';

import { SubjectPage } from '#client/features/collections/index.ts';

export function PageView({ project }: { project?: ProjectId }) {
  return project ? <SubjectPage key={String(project)} project={project} /> : null;
}
