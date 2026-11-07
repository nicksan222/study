import { useId } from 'react';

import { semanticPart as part } from './semantic-part';

import './tool-activity.css';

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
  Metadata: part('div', 'ui-tool-activity-metadata'),
  Detail,
  Note: part('p', 'ui-tool-activity-note'),
  Name: part('code', 'ui-tool-activity-name')
};
