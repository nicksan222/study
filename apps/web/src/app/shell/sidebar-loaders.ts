import { libraryQueryOptions } from '#web/features/library/index.ts';
import type { AppSearch } from '#web/lib/navigation/route-contract.ts';
import { projectsQueryOptions, sessionsQueryOptions } from '#web/lib/study-client/study.queries.ts';

import type { AppRouterContext } from '../router-context';

export function loadSidebar({ context }: { context: AppRouterContext }) {
  // Keep the shell usable while its independently retryable panels load.
  void context.queryClient.prefetchQuery(projectsQueryOptions());
  void context.queryClient.prefetchQuery(sessionsQueryOptions());
}

export const practiceLoaderDeps = ({ search }: { search: AppSearch }) => ({
  project: search.project
});

export const loadPracticeSidebar = async ({
  context,
  deps
}: {
  context: AppRouterContext;
  deps: { project?: string };
}) => {
  const subjects = await context.queryClient.ensureQueryData(projectsQueryOptions());
  const project = subjects.find((subject) => String(subject.id) === deps.project);

  if (deps.project && !project) return;

  await context.queryClient.ensureQueryData(libraryQueryOptions(subjects, project?.id));
};
