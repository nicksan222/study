import type { ProjectId } from '@study/contracts/ids';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';

import type { Subjects } from '../../lib/study-client/operations';
import { LibraryListView } from './library-list.view';
import type { ItemFilter } from './library.logic';
import { libraryQueryOptions } from './library.queries';

export function LibraryList({
  section,
  subjects,
  project,
  blocked,
  ready,
  query,
  filter
}: {
  section: 'library' | 'practice';
  subjects: Subjects;
  project?: ProjectId;
  blocked: boolean;
  ready: boolean;
  query: string;
  filter: ItemFilter;
}) {
  const search = useSearch({ from: '__root__' });
  const state = useQuery(libraryQueryOptions(section, subjects, project, !blocked && ready));

  return (
    <LibraryListView
      {...{ state, section, subjects, blocked, query, filter, search }}
      reload={() => {
        void state.refetch();
      }}
    />
  );
}
