import { CircleAlert } from 'lucide-react';
import { useId } from 'react';
import type { ReactNode } from 'react';

export function ErrorState({
  title,
  description,
  action,
  layout = 'inline'
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  layout?: 'page' | 'inline' | 'sidebar';
}) {
  const id = useId();
  return (
    <section role="alert" aria-labelledby={id} className="ui-error-state" data-layout={layout}>
      <div className="ui-error-state-icon">
        <CircleAlert aria-hidden="true" size={20} strokeWidth={1.5} />
      </div>
      <div className="ui-error-state-content">
        <h2 id={id}>{title}</h2>
        {description && <div className="ui-error-state-description">{description}</div>}
        {action && <div className="ui-error-state-action">{action}</div>}
      </div>
    </section>
  );
}
