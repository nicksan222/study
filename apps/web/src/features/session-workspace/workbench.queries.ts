import type { SessionId, MaterialId } from '@study/contracts/ids';
import { useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';

import { pageIdentity } from './page-autosave.queries';
import type { PageTarget } from './page-autosave.queries';
import { threadOptions } from './session-workspace.queries';

export type WorkbenchTarget =
  | PageTarget
  | { kind: 'material'; materialId: MaterialId; title: string };

export function workbenchIdentity(target: WorkbenchTarget) {
  return target.kind === 'material' ? `material:${target.materialId}` : pageIdentity(target);
}

type Workbench = {
  tabs: WorkbenchTarget[];
  active?: string;
  visible: boolean;
  expanded: boolean;
};

/** Retains document tabs and unsent pages across session navigation without mixing them with chat drafts. */
export function useWorkbench(id: SessionId) {
  const cache = useQueryClient();
  const key = ['session-drafts', String(id), 'workbench'];
  const initial: Workbench = { tabs: [], visible: false, expanded: false };
  const state = useQuery({
    queryKey: key,
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const thread = useInfiniteQuery(threadOptions(id));
  const messages = thread.data?.pages.flatMap((page) => page.items) ?? [];
  const model = state.data;
  const update = (change: (value: Workbench) => Workbench) =>
    cache.setQueryData<Workbench>(key, (value) => change(value ?? initial));

  function open(target: WorkbenchTarget) {
    const identity = workbenchIdentity(target);

    update((value) => ({
      ...value,
      tabs: value.tabs.some((tab) => workbenchIdentity(tab) === identity)
        ? value.tabs
        : [...value.tabs, target],
      active: identity,
      visible: true
    }));
  }

  function close(identity: string) {
    update((value) => {
      const index = value.tabs.findIndex((tab) => workbenchIdentity(tab) === identity);
      const tabs = value.tabs.filter((tab) => workbenchIdentity(tab) !== identity);
      const active = value.active === identity ? tabs[Math.min(index, tabs.length - 1)] : undefined;

      return {
        ...value,
        tabs,
        active: active
          ? workbenchIdentity(active)
          : value.active === identity
            ? undefined
            : value.active,
        visible: tabs.length > 0 && value.visible
      };
    });
  }

  const tabs = model.tabs.map((tab) => {
    if (tab.kind === 'material') return tab;

    const message = messages.find(
      (item) => (item.captureKey ?? String(item.id)) === workbenchIdentity(tab)
    );

    return message ? { kind: 'message' as const, message } : tab;
  });

  return {
    ...model,
    tabs,
    open,
    close,
    select: (active: string) => update((value) => ({ ...value, active, visible: true })),
    hide: () => update((value) => ({ ...value, visible: false })),
    expand: () => update((value) => ({ ...value, expanded: !value.expanded }))
  };
}
