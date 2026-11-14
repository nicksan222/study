import { rpc } from '@study/contracts/react';

import type { AppSearch } from '#client/lib/navigation/route-contract.ts';

/** Preloading is a bounded one-shot read; mounted views always reconcile independently. */
export function loadSidebar() {
  void rpc.projects.list.read({ limit: 100 }).catch(() => {});
  void rpc.notes.list.read({ limit: 100 }).catch(() => {});
}

export const practiceLoaderDeps = ({ search }: { search: AppSearch }) => ({
  project: search.project
});

export const loadPracticeSidebar = async ({ deps }: { deps: { project?: string } }) => {
  const subjects = await rpc.projects.list.read({ limit: 100 });
  const project = subjects.items.find((subject) => String(subject.id) === deps.project);

  if (deps.project && !project) return;

  await rpc.materials.list.read({ projectId: project?.id, archived: false, limit: 100 });
};
