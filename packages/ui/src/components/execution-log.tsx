import { ThinkingIcon, DisclosureIcon } from '@study/icons';
import type { ReactNode } from 'react';

import { Notebook } from './note-workspace';

export type ExecutionLogItem = {
  id: string;
  title: string;
  status: string;
  icon: ReactNode;
  metadata: readonly { label: string; value: ReactNode }[];
  children?: ReactNode;
};

/** Shows execution snapshots; connection and recovery behavior belong to the caller. */
export function ExecutionLog({
  label,
  pendingLabel,
  items
}: {
  label: string;
  pendingLabel: string;
  items: readonly ExecutionLogItem[];
}) {
  return (
    <Notebook.WorkLog role="status" aria-label={label} aria-live="polite" aria-atomic="true">
      {!items.length && (
        <Notebook.WorkRow>
          <ThinkingIcon aria-hidden="true" />
          <span>{pendingLabel}</span>
        </Notebook.WorkRow>
      )}
      {items.map((item) => (
        <Notebook.WorkItem key={item.id}>
          <Notebook.WorkSummary>
            {item.icon}
            <Notebook.WorkCopy>
              <span>{item.title}</span>
              <span aria-hidden="true">·</span>
              <span>{item.status}</span>
            </Notebook.WorkCopy>
            <DisclosureIcon aria-hidden="true" />
          </Notebook.WorkSummary>
          <Notebook.WorkMetadata>
            {item.metadata.map((row) => (
              <Metadata key={row.label} {...row} />
            ))}
          </Notebook.WorkMetadata>
          {item.children}
        </Notebook.WorkItem>
      ))}
    </Notebook.WorkLog>
  );
}

function Metadata({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
