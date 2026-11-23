import { Tabs } from '@base-ui/react/tabs';
import { CloseIcon } from '@study/icons';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

type WorkspaceTab = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  close?: { label: string; onClick: () => void };
};

/** Renders the selected workspace tab and keeps its close button independent of tab selection. */
export function WorkspacePanel({
  label,
  tabs,
  active,
  onSelect,
  beforeTabs,
  afterTabs,
  children
}: {
  label: string;
  tabs: readonly WorkspaceTab[];
  active: string;
  onSelect: (id: string) => void;
  beforeTabs?: ReactNode;
  afterTabs?: ReactNode;
  children: ReactNode;
}) {
  const panelId = useId();
  const activeTab = useRef<HTMLDivElement>(null);
  const activeTabButton = useRef<HTMLButtonElement>(null);
  const keyboardClosedTab = useRef<string | null>(null);

  useLayoutEffect(() => {
    const closed = keyboardClosedTab.current;

    if (closed === null || tabs.some((tab) => tab.id === closed)) return;

    keyboardClosedTab.current = null;
    activeTabButton.current?.focus();
  }, [tabs]);

  useEffect(() => {
    activeTab.current?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'instant'
    });
  }, [active]);

  return (
    <Tabs.Root
      className="workspace-panel"
      value={active}
      onValueChange={(value) => {
        if (typeof value === 'string') onSelect(value);
      }}
    >
      <div className="workspace-panel-header">
        {beforeTabs && <div className="workspace-panel-before">{beforeTabs}</div>}
        <Tabs.List className="workspace-panel-tabs" aria-label={label}>
          {tabs.map((tab, index) => {
            const labelId = `${panelId}-${index}`;
            const close = tab.close;

            return (
              <div
                className="workspace-panel-tab"
                key={tab.id}
                ref={tab.id === active ? activeTab : undefined}
              >
                <Tabs.Tab value={tab.id} ref={tab.id === active ? activeTabButton : undefined}>
                  {tab.icon}
                  <span id={labelId}>{tab.label}</span>
                </Tabs.Tab>
                {close && (
                  <button
                    className="workspace-panel-tab-close"
                    type="button"
                    aria-label={close.label}
                    aria-describedby={labelId}
                    title={close.label}
                    onClick={(event) => {
                      keyboardClosedTab.current = event.detail === 0 ? tab.id : null;
                      close.onClick();
                    }}
                  >
                    <CloseIcon size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </Tabs.List>
        {afterTabs && <div className="workspace-panel-after">{afterTabs}</div>}
      </div>
      <Tabs.Panel className="workspace-panel-content" value={active}>
        {children}
      </Tabs.Panel>
    </Tabs.Root>
  );
}
