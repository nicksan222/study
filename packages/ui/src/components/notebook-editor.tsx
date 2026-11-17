import { useLayoutEffect, useState } from 'react';
import type { ComponentProps, CSSProperties, RefObject } from 'react';

import { DialogPopup } from './dialog';
import { semanticPart as part } from './semantic-part';

function notebookBounds(anchor: HTMLElement | null) {
  const notebook = anchor?.closest('.workspace-desk-notebook');
  const viewport = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const rect = notebook?.getBoundingClientRect() ?? viewport;
  const board = notebook?.querySelector('.workspace-desk-board')?.getBoundingClientRect() ?? rect;

  return { notebook, rect, board };
}

function visibleBounds(anchor: HTMLElement | null): CSSProperties {
  const { rect, board } = notebookBounds(anchor);
  // DOM rectangles use physical pixels; the portal inherits the application's CSS zoom.
  const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  // Use the available screen on compact layouts rather than squeezing writing
  // beside an expanded sidebar.
  const writing = board.width / zoom < 384 ? { left: 0, width: window.innerWidth } : board;
  const left = Math.max(0, writing.left);
  const top = Math.max(0, rect.top);
  const width = Math.min(writing.width, window.innerWidth - left);
  // Zoom can make the shell taller than the viewport; keep return/save controls visible.
  const height = Math.min(rect.height, (window.visualViewport?.height ?? window.innerHeight) - top);

  return {
    '--notebook-editor-left': `${left / zoom}px`,
    '--notebook-editor-top': `${top / zoom}px`,
    '--notebook-editor-width': `${width / zoom}px`,
    '--notebook-editor-height': `${height / zoom}px`
  } as CSSProperties;
}

/** Lifts writing over its notebook while the dialog owns focus, dismissal and scroll locking. */
function Popup({
  anchor,
  open,
  ...props
}: Omit<ComponentProps<typeof DialogPopup>, 'variant' | 'style'> & {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
}) {
  const [bounds, setBounds] = useState<CSSProperties>();

  useLayoutEffect(() => {
    if (!open) return;

    const { notebook } = notebookBounds(anchor.current);
    const measure = () => setBounds(visibleBounds(anchor.current));

    measure();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);

    if (notebook) observer?.observe(notebook);

    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [anchor, open]);

  return (
    <DialogPopup
      {...props}
      variant="notebook-editor"
      style={bounds}
      bottomStickOnMobile={false}
      showCloseButton={false}
    />
  );
}

function Label({ full, compact }: { full: string; compact: string }) {
  return (
    <>
      <span className="notebook-editor-label-wide">{full}</span>
      <span className="notebook-editor-label-compact" aria-hidden="true">
        {compact}
      </span>
    </>
  );
}

export const NotebookEditor = {
  Popup,
  Label,
  Header: part('header', 'notebook-editor-header'),
  Identity: part('div', 'notebook-editor-identity'),
  Subject: part('div', 'notebook-editor-subject'),
  Metadata: part('div', 'notebook-editor-metadata'),
  Body: part('div', 'notebook-editor-body'),
  Text: part('textarea', 'notebook-editor-text'),
  Footer: part('footer', 'notebook-editor-footer'),
  Feedback: part('div', 'notebook-editor-feedback'),
  Status: part('span', 'notebook-editor-status')
};
