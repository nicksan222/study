import type { ProjectId } from '@study/contracts/ids';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearch } from '@tanstack/react-router';

import type { Subjects } from '#client/lib/study-client/operations.ts';

import { LibraryListView } from './library-list.view';
import { libraryQueryOptions } from './library.queries';

export function LibraryList({
  subjects,
  project,
  blocked,
  ready,
  query
}: {
  subjects: Subjects;
  project?: ProjectId;
  blocked: boolean;
  ready: boolean;
  query: string;
}) {
  const params = useParams({ strict: false });
  const search = useSearch({ from: '__root__' });
  const state = useQuery(libraryQueryOptions(subjects, project, !blocked && ready));

  return (
    <LibraryListView
      {...{ state, subjects, blocked, query, search }}
      selectedMaterial={params.materialId}
      reload={() => {
        void state.refetch();
      }}
    />
  );
}
