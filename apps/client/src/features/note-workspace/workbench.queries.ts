import { RegistryContext, useAtomValue } from '@effect/atom-react';
import type { NoteId, PageId, SourceId } from '@study/contracts/ids';
import { Atom } from 'effect/reactivity';
import { useContext } from 'react';

import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { useThreadPage } from './note-reads';
import { pageIdentity } from './page-autosave.queries';
import type { PageTarget } from './page-autosave.queries';

export type WorkbenchTarget =
  | { kind: 'assistant' }
  | PageTarget
  | { kind: 'page'; pageId: PageId; title: string }
  | { kind: 'source'; sourceId: SourceId; title: string };

export function workbenchIdentity(target: WorkbenchTarget) {
  if (target.kind === 'assistant') return 'assistant';

  return target.kind === 'page'
    ? `page:${target.pageId}`
    : target.kind === 'source'
      ? `source:${target.sourceId}`
      : pageIdentity(target);
}

type Workbench = {
  tabs: WorkbenchTarget[];
  active?: string;
  visible: boolean;
  expanded?: boolean;
  dock?: 'side' | 'bottom';
  cardHidden?: boolean;
};

const workbenchState = Atom.family((_id: NoteId) =>
  Atom.make<Workbench>({ tabs: [], visible: false }).pipe(Atom.keepAlive)
);

/** Retains page tabs and unsent pages across note navigation without mixing them with chat drafts. */

export function useWorkbench(id: NoteId) {
  const cache = useContext(RegistryContext);
  const preferences = useWorkspacePreferences();
  const atom = workbenchState(id);
  const model = useAtomValue(atom);
  const thread = useThreadPage(id);
  const messages = thread.data?.items ?? [];
  const update = (change: (value: Workbench) => Workbench) => cache.update(atom, change);

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
    if (tab.kind === 'assistant' || tab.kind === 'page' || tab.kind === 'source') return tab;

    const message = messages.find(
      (item) => (item.captureKey ?? String(item.id)) === workbenchIdentity(tab)
    );

    return message ? { kind: 'message' as const, message } : tab;
  });

  return {
    ...model,
    expanded: model.expanded ?? preferences.expandPages,
    tabs,
    dock: model.dock ?? 'side',
    cardVisible: !model.visible && !model.cardHidden,
    toggleCard: () =>
      update((value) => ({
        ...value,
        visible: false,
        cardHidden: value.visible ? false : !value.cardHidden
      })),
    hideCard: () => update((value) => ({ ...value, cardHidden: true })),
    showEditor: (dock: 'side' | 'bottom') =>
      update((value) => {
        if (!value.tabs.length) return value;

        return {
          ...value,
          dock,
          visible: true,
          expanded: false,
          active: value.tabs.some((tab) => workbenchIdentity(tab) === value.active)
            ? value.active
            : workbenchIdentity(value.tabs[0]!)
        };
      }),
    open,
    close,
    select: (active: string) => update((value) => ({ ...value, active, visible: true })),
    hide: () => update((value) => ({ ...value, visible: false })),
    expand: () =>
      update((value) => ({ ...value, expanded: !(value.expanded ?? preferences.expandPages) }))
  };
}
