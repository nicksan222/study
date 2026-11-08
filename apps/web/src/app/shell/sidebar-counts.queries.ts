import type { ProjectId } from '@study/contracts/ids';
import { useQuery } from '@tanstack/react-query';

import { libraryQueryOptions } from '#web/features/library/index.ts';
import type { Notes, Subjects } from '#web/lib/study-client/operations.ts';
import { countPages } from '#web/lib/study-client/operations.ts';

import { useSidebarProgress } from './rich-sidebar.queries';

/** Counts every retained item, independently of search and loaded sidebar pages. */
export function useSidebarCounts({
  project,
  subjects,
  notes,
  notesReady,
  ready
}: {
  project?: ProjectId;
  subjects: Subjects;
  notes: Notes;
  notesReady: boolean;
  ready: boolean;
}) {
  const { settings, progress } = useSidebarProgress();
  const pages = useQuery({
    queryKey: ['pages', 'navigation-count', project?.toString()],
    queryFn: ({ signal }) => countPages(project, signal),
    enabled: ready,
    refetchInterval: 15_000
  });
  const practice = useQuery(libraryQueryOptions(subjects, project, ready));
  const threshold = BigInt(settings.data?.settledPageThreshold ?? 1);
  const summaries = new Map(progress.data?.items.map((item) => [item.id, item]));
  const unresolved = notes.some((note) => {
    const summary = summaries.get(note.id);

    return (
      !summary ||
      summary.running ||
      !(summary.settledOverride ?? summary.generatedPageCount >= threshold)
    );
  });

  return {
    notes: { count: ready && notesReady ? notes.length : undefined, unresolved },
    pages: { count: ready && pages.isSuccess ? pages.data : undefined },
    practice: {
      count:
        ready && practice.isSuccess
          ? new Set(practice.data.map((item) => item.value.id)).size
          : undefined
    }
  };
}
