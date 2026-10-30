import { mutationOptions, queryOptions } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import {
  createProject,
  createSession,
  listProjects,
  listSessions,
  searchStudy
} from './operations';
import type { SearchInput } from './operations';

export const projectsQueryOptions = () =>
  queryOptions({
    queryKey: ['projects'],
    queryFn: ({ signal }) => listProjects(signal)
  });

export const sessionsQueryOptions = () =>
  queryOptions({
    queryKey: ['sessions'],
    queryFn: ({ signal }) => listSessions(signal),
    refetchOnWindowFocus: 'always'
  });

export const searchQueryOptions = (input: SearchInput, enabled: boolean) =>
  queryOptions({
    queryKey: ['search', { ...input, project: input.project?.toString() }],
    queryFn: ({ signal }) => searchStudy(input, signal),
    enabled
  });

export const createProjectMutationOptions = (client: QueryClient) =>
  mutationOptions({
    mutationFn: createProject,
    onSuccess: async (created) => {
      const { queryKey } = projectsQueryOptions();

      await client.cancelQueries({ queryKey });
      client.setQueryData(queryKey, (items) => [
        ...(items ?? []).filter((item) => item.id !== created.id),
        created
      ]);
    }
  });

export const createSessionMutationOptions = (client: QueryClient) =>
  mutationOptions({
    mutationFn: createSession,
    onSuccess: async () => {
      const { queryKey } = sessionsQueryOptions();

      await client.cancelQueries({ queryKey });
      void client.invalidateQueries({ queryKey });
    }
  });
