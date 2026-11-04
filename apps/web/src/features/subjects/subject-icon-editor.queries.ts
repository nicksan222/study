import type { ProjectId } from '@study/contracts/ids';
import type { ProjectIcon } from '@study/contracts/projects/schemas';
import { mutationOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

/** Stores the canonical icon under the same subject identity used by the shared pending fence. */
export const subjectIconMutationOptions = (id: ProjectId) =>
  mutationOptions({
    mutationKey: ['subject-icon', String(id)],
    mutationFn: (icon: ProjectIcon) =>
      request((client) => client['projects.setIcon']({ id, icon })),
    retry: false
  });
