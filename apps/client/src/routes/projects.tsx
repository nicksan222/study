import { projectIdSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/projects/page';

export const Route = createFileRoute('/projects')({
  staticData: { title: 'Projects', section: 'notes', scope: 'project' },
  loaderDeps: ({ search }) => ({ project: search.project }),
  loader: ({ deps }) =>
    deps.project
      ? rpc.projects.get.read({ id: projectIdSchema.make(BigInt(deps.project)) })
      : undefined,
  component: Page
});
