import { Check, ChevronRight, Circle, X } from 'lucide-react';
import { useId } from 'react';
import type { ReactNode } from 'react';

import { Disclosure } from './disclosure';
import { semanticPart as part } from './semantic-part';

import './tool-activity.css';

function Call({
  label,
  status,
  stateLabel,
  children
}: {
  label: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  stateLabel: string;
  children: ReactNode;
}) {
  const StatusIcon = status === 'completed' ? Check : status === 'running' ? Circle : X;

  return (
    <Disclosure
      variant="activity"
      summary={
        <>
          <ChevronRight className="ui-tool-activity-chevron" size={12} aria-hidden="true" />
          <StatusIcon size={12} aria-hidden="true" />
          <span className="ui-tool-activity-label">{label}</span>
          <span className={status === 'completed' ? 'sr-only' : 'ui-tool-activity-state'}>
            {stateLabel}
          </span>
        </>
      }
    >
      <div className="ui-tool-activity-details">{children}</div>
    </Disclosure>
  );
}

function Detail({ label, text, notice }: { label: string; text: string; notice?: string }) {
  const noticeId = useId();

  return (
    <div className="ui-tool-activity-detail">
      <p>{label}</p>
      <textarea
        readOnly
        aria-label={label}
        aria-describedby={notice ? noticeId : undefined}
        value={text}
        rows={Math.min(12, text.split('\n').length)}
        spellCheck={false}
      />
      {notice && (
        <p id={noticeId} className="ui-tool-activity-notice">
          {notice}
        </p>
      )}
    </div>
  );
}

export const ToolActivity = {
  List: part('div', 'ui-tool-activity'),
  Call,
  Detail,
  Note: part('p', 'ui-tool-activity-note'),
  Name: part('code', 'ui-tool-activity-name')
};
