import { libraryQueryOptions } from '../../features/library';
import type { AppSearch } from '../../lib/navigation/route-contract';
import { projectsQueryOptions, sessionsQueryOptions } from '../../lib/study-client/study.queries';
import type { AppRouterContext } from '../router-context';

export function loadSidebar({ context }: { context: AppRouterContext }) {
  // Keep the shell usable while its independently retryable panels load.
  void context.queryClient.prefetchQuery(projectsQueryOptions());
  void context.queryClient.prefetchQuery(sessionsQueryOptions());
}

export const libraryLoaderDeps = ({ search }: { search: AppSearch }) => ({
  project: search.project
});

export const loadLibrarySidebar =
  (section: 'library' | 'practice') =>
  async ({ context, deps }: { context: AppRouterContext; deps: { project?: string } }) => {
    const subjects = await context.queryClient.ensureQueryData(projectsQueryOptions());
    const project = subjects.find((subject) => String(subject.id) === deps.project);

    if (deps.project && !project) return;

    await context.queryClient.ensureQueryData(libraryQueryOptions(section, subjects, project?.id));
  };
