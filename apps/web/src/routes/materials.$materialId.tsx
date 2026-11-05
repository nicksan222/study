import { createFileRoute } from '@tanstack/react-router';

import {
  ReaderPage,
  MaterialRouteError,
  materialOptions,
  materialId
} from '../features/material-library';

export const Route = createFileRoute('/materials/$materialId')({
  staticData: { title: 'Practice', section: 'practice', scope: 'global' },
  beforeLoad: ({ params }) => {
    materialId(params.materialId);
  },
  loaderDeps: ({ search }) => ({ project: search.project }),
  loader: ({ context, params }) =>
    context.queryClient.prefetchQuery(materialOptions(materialId(params.materialId))),
  errorComponent: MaterialRouteError,
  component: ReaderPage
});
