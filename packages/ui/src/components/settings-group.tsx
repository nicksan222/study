import { useId } from 'react';
import type { ReactNode } from 'react';

export function SettingsGroup({ children }: { children: ReactNode }) {
  return <div className="settings-group">{children}</div>;
}

export function SettingsRow({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const id = useId();

  return (
    <div className="settings-row" role="group" aria-labelledby={id}>
      <div className="settings-row-copy">
        <h4 id={id}>{title}</h4>
        <p>{description}</p>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}
