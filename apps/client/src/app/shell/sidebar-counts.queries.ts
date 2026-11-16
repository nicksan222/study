import type { ProjectId } from '@study/contracts';
import { rpc } from '@study/contracts/react';

import type { Notes, Subjects } from '#client/lib/study-client/types.ts';

import { useSidebarProgress } from './rich-sidebar.queries';

/** Counts every retained item, independently of search and loaded sidebar pages. */
export function useSidebarCounts({
  project,
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
  const count = rpc.notes.count.useQuery({ project }, { enabled: ready });
  const pages = rpc.pages.count.useQuery(
    { projectId: project, archived: false },
    { enabled: ready }
  );
  const practice = rpc.materials.count.useQuery(
    { projectId: project, archived: false },
    { enabled: ready }
  );
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
    notes: {
      count: ready && notesReady && count.isSuccess ? Number(count.data) : undefined,
      unresolved
    },
    pages: { count: ready && pages.isSuccess ? Number(pages.data) : undefined },
    practice: {
      count: ready && practice.isSuccess ? Number(practice.data) : undefined
    }
  };
}
