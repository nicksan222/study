import type { ProjectId } from '@study/contracts/ids';
import { useQuery } from '@tanstack/react-query';
import { useSearch, useParams } from '@tanstack/react-router';

import type { Subjects } from '#web/lib/study-client/operations.ts';

import { LibraryListView } from './library-list.view';
import { libraryQueryOptions } from './library.queries';

export function LibraryList({
  section,
  subjects,
  project,
  blocked,
  ready,
  query
}: {
  section: 'library' | 'practice';
  subjects: Subjects;
  project?: ProjectId;
  blocked: boolean;
  ready: boolean;
  query: string;
}) {
  const search = useSearch({ from: '__root__' });
  const params = useParams({ strict: false });
  const state = useQuery(libraryQueryOptions(section, subjects, project, !blocked && ready));

  return (
    <LibraryListView
      {...{ state, section, subjects, blocked, query, search }}
      selected={{ source: params.sourceId, document: params.documentId }}
      reload={() => {
        void state.refetch();
      }}
    />
  );
}
