import { Popover } from '@base-ui/react/popover';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from './button';

/** A numbered evidence reference with a keyboard and touch accessible preview. */
export function Citation({
  marker,
  label,
  sourceName,
  closeLabel,
  children
}: {
  marker: number;
  label: string;
  sourceName?: string;
  closeLabel: string;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        className={sourceName ? 'citation-source' : 'citation-marker'}
        aria-label={label}
      >
        <span className="citation-number">{marker}</span>
        {sourceName && <span className="citation-source-name">{sourceName}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start" className="citation-positioner">
          <Popover.Popup className="citation-preview" aria-label={label}>
            <Popover.Close
              render={<Button size="icon-sm" variant="ghost-muted" />}
              className="citation-close"
              aria-label={closeLabel}
            >
              <X size={14} aria-hidden="true" />
            </Popover.Close>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function CitationSources({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="citation-sources" role="group" aria-label={label}>
      <span className="citation-sources-label">{label}</span>
      <div className="citation-source-list">{children}</div>
    </div>
  );
}

export function CitationEvidence({
  title,
  location,
  quote,
  precision,
  action
}: {
  title: ReactNode;
  location?: string;
  quote: string;
  precision: string;
  action?: ReactNode;
}) {
  return (
    <>
      <div className="citation-title">{title}</div>
      {location && <p className="citation-location">{location}</p>}
      <blockquote className="citation-quote">{quote}</blockquote>
      <div className="citation-footer">
        <p className="citation-precision">{precision}</p>
        {action}
      </div>
    </>
  );
}
