import type { ProjectId } from '@study/contracts/ids';
import { useQuery } from '@tanstack/react-query';

import { libraryQueryOptions } from '#web/features/library/index.ts';
import type { Sessions, Subjects } from '#web/lib/study-client/operations.ts';
import { countDocuments } from '#web/lib/study-client/operations.ts';

import { useSidebarProgress } from './rich-sidebar.queries';

/** Counts every retained item, independently of search and loaded sidebar pages. */
export function useSidebarCounts({
  project,
  subjects,
  sessions,
  sessionsReady,
  ready
}: {
  project?: ProjectId;
  subjects: Subjects;
  sessions: Sessions;
  sessionsReady: boolean;
  ready: boolean;
}) {
  const { settings, progress } = useSidebarProgress();
  const documents = useQuery({
    queryKey: ['documents', 'navigation-count', project?.toString()],
    queryFn: ({ signal }) => countDocuments(project, signal),
    enabled: ready,
    refetchInterval: 15_000
  });
  const practice = useQuery(libraryQueryOptions(subjects, project, ready));
  const threshold = BigInt(settings.data?.settledDocumentThreshold ?? 1);
  const summaries = new Map(progress.data?.items.map((item) => [item.id, item]));
  const unresolved = sessions.some((session) => {
    const summary = summaries.get(session.id);

    return (
      !summary ||
      summary.running ||
      !(summary.settledOverride ?? summary.generatedDocumentCount >= threshold)
    );
  });

  return {
    sessions: { count: ready && sessionsReady ? sessions.length : undefined, unresolved },
    documents: { count: ready && documents.isSuccess ? documents.data : undefined },
    practice: {
      count:
        ready && practice.isSuccess
          ? new Set(practice.data.map((item) => item.value.id)).size
          : undefined
    }
  };
}
