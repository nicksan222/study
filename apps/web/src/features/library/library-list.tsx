import type { ProjectId } from '@study/contracts/ids';
import { useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';

import { useOperation } from '../../lib/effect/use-operation';
import type { Subjects } from '../../lib/study-client/operations';
import { LibraryListView } from './library-list.view';
import { loadLibraryItems } from './library.logic';
import type { ItemFilter } from './library.logic';

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
  const projectIds = useMemo(
    () => (project ? [project] : subjects.map((subject) => subject.id)),
    [project, subjects]
  );
  const key = JSON.stringify([section, projectIds.map(String)]);
  const operation = useMemo(
    () => (!blocked && ready ? loadLibraryItems(section, projectIds, project) : undefined),
    [blocked, ready, section, projectIds, project]
  );
  const { state, reload } = useOperation(key, operation, true);

  return (
    <LibraryListView {...{ state, section, subjects, blocked, query, filter, search, reload }} />
  );
}
