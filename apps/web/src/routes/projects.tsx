import { projectIdSchema } from '@study/contracts/ids';
import { createFileRoute } from '@tanstack/react-router';

import { subjectProjectOptions } from '../features/collections';
import { Page } from '../pages/projects/page';

export const Route = createFileRoute('/projects')({
  staticData: { title: 'Projects', section: 'sessions', scope: 'project' },
  loaderDeps: ({ search }) => ({ project: search.project }),
  loader: ({ context, deps }) =>
    deps.project
      ? context.queryClient.ensureQueryData(
          subjectProjectOptions(projectIdSchema.make(BigInt(deps.project)))
        )
      : undefined,
  component: Page
});
