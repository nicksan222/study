import type { ProjectId } from '@study/contracts';
import { rpc } from '@study/contracts/react';

/** Counts every retained item, independently of search and loaded sidebar pages. */
export function useSidebarCounts({
  project,
  notesReady,
  ready
}: {
  project?: ProjectId;
  notesReady: boolean;
  ready: boolean;
}) {
  const count = rpc.notes.count.useQuery({ project }, { enabled: ready });
  const pages = rpc.pages.count.useQuery(
    { projectId: project, archived: false },
    { enabled: ready }
  );
  const practice = rpc.materials.count.useQuery(
    { projectId: project, archived: false },
    { enabled: ready }
  );

  return {
    notes: {
      count: ready && notesReady && count.isSuccess ? Number(count.data) : undefined
    },
    practice: {
      count:
        ready && practice.isSuccess && pages.isSuccess
          ? Number(practice.data) + Number(pages.data)
          : undefined
    }
  };
}
