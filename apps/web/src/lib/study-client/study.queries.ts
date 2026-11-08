import { mutationOptions, queryOptions } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import { createProject, listProjects, listNotes, searchStudy } from './operations';
import type { SearchInput } from './operations';

export const projectsQueryOptions = () =>
  queryOptions({
    queryKey: ['projects'],
    queryFn: ({ signal }) => listProjects(signal)
  });

export const notesQueryOptions = () =>
  queryOptions({
    queryKey: ['notes'],
    queryFn: ({ signal }) => listNotes(signal),
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) =>
      query.state.data?.some((note) => note.titleSource === 'provisional') ? 3000 : false
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
