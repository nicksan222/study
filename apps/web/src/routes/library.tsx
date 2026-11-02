import { createFileRoute } from '@tanstack/react-router';

import { LibraryPage, materialsOptions, collectionId } from '../features/material-library';
import { projectsQueryOptions } from '../lib/study-client/study.queries';

export const Route = createFileRoute('/library')({
  staticData: { title: 'SidebarLibrary', section: 'library', scope: 'global' },
  loaderDeps: ({ search }) => ({ project: search.project }),
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.prefetchInfiniteQuery(materialsOptions(collectionId(deps.project))),
      context.queryClient.prefetchQuery(projectsQueryOptions())
    ]);
  },
  component: LibraryPage
});
