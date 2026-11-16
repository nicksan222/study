import type { ReactElement, ReactNode } from 'react';

import { Sidebar } from './sidebar';

export type SidebarSearchItem = {
  key: string;
  title: string;
  context: string;
  excerpt?: string | null;
  icon: ReactNode;
  render: ReactElement;
};

/** Renders the same search rows for connected navigation and isolated examples. */
export function SidebarSearchResults({
  label,
  pending,
  feedback,
  items,
  render
}: {
  label: string;
  render?: ReactElement;
  pending: boolean;
  feedback?: ReactNode;
  items: readonly SidebarSearchItem[];
}) {
  return (
    <Sidebar.Items render={render} aria-label={label} aria-busy={pending}>
      {feedback}
      {items.map((item) => (
        <Sidebar.Item
          key={item.key}
          label={item.title}
          title={item.title}
          description={item.excerpt ?? undefined}
          context={item.context}
          icon={item.icon}
          render={item.render}
        />
      ))}
    </Sidebar.Items>
  );
}
