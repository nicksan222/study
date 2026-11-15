import { rpc } from '@study/contracts/react';
import { createFileRoute } from '@tanstack/react-router';

import { ReaderPage, MaterialRouteError, materialId } from '../features/material-library';

export const Route = createFileRoute('/materials/$materialId')({
  staticData: { title: 'Practice', section: 'practice', scope: 'global' },
  beforeLoad: ({ params }) => {
    materialId(params.materialId);
  },
  loaderDeps: ({ search }) => ({ project: search.project }),
  loader: ({ params }) =>
    rpc.materials.get.read({ id: materialId(params.materialId) }).catch(() => undefined),
  errorComponent: MaterialRouteError,
  component: ReaderPage
});
