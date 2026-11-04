import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { semanticPart as part } from './semantic-part';
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from './tooltip';

function Marker({
  target,
  label,
  preview,
  kind,
  onSelect
}: {
  target: string;
  label: ReactNode;
  preview: ReactNode;
  kind: 'note' | 'reply' | 'document' | 'attachment';
  onSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const previewId = useId();
  const labelId = useId();

  return (
    <Tooltip onOpenChange={setOpen} disableHoverablePopup>
      <TooltipTrigger
        render={<button type="button" aria-labelledby={labelId} className="notebook-rail-marker" />}
        data-kind={kind}
        data-notebook-marker
        aria-describedby={open ? previewId : undefined}
        data-target={target}
        onClick={onSelect}
      >
        <span className="notebook-rail-tick" aria-hidden="true" />
        <span id={labelId} className="sr-only">
          {label}
        </span>
      </TooltipTrigger>
      <TooltipPopup id={previewId} role="tooltip" side="right" align="start" sideOffset={8}>
        <div className="notebook-rail-preview">{preview}</div>
      </TooltipPopup>
    </Tooltip>
  );
}

function Root({ label, children }: { label: string; children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  const magnify = (position?: number) => {
    const markers = [
      ...(root.current?.querySelectorAll<HTMLElement>('[data-notebook-marker]') ?? [])
    ];
    const centers = markers.map((marker) => {
      const rect = marker.getBoundingClientRect();

      return rect.top + rect.height / 2;
    });
    const step =
      Math.abs((centers[1] ?? 0) - (centers[0] ?? 0)) ||
      markers[0]?.getBoundingClientRect().height ||
      1;

    markers.forEach((marker, index) => {
      const scale =
        position === undefined ? 1 : 1 + 1.5 * 0.5 ** (Math.abs(centers[index]! - position) / step);

      marker.style.setProperty('--notebook-marker-scale', String(scale));
    });
  };
  const focusPosition = (element: Element | null) => {
    const marker = element?.closest<HTMLElement>('[data-notebook-marker]');

    if (!marker || !root.current?.contains(marker)) return undefined;

    const rect = marker.getBoundingClientRect();

    return rect.top + rect.height / 2;
  };

  return (
    <TooltipProvider delay={120}>
      <nav
        ref={root}
        className="notebook-rail"
        aria-label={label}
        onPointerMove={(event) => magnify(event.clientY)}
        onPointerLeave={() => magnify(focusPosition(document.activeElement))}
        onFocus={(event) => magnify(focusPosition(event.target))}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) magnify();
        }}
      >
        {children}
      </nav>
    </TooltipProvider>
  );
}

export const NotebookRail = { Root, Marker, More: part('button', 'notebook-rail-more') };
