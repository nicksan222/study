import type { ComponentProps, ReactNode, Ref } from 'react';

/** A flat writing page with a document title and a quiet persistence status. */
export function WritingSurface({
  ref,
  heading,
  status,
  children
}: {
  ref?: Ref<HTMLDivElement>;
  heading: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="writing-surface" ref={ref}>
      <div className="writing-surface-heading">{heading}</div>
      {children}
      <div className="writing-surface-status" role="status" aria-atomic="true">
        {status}
      </div>
    </div>
  );
}

/** Mirrors the title text so the input grows with wrapped lines on narrower pages. */
export function WritingTitle({
  value,
  ...props
}: Omit<ComponentProps<'textarea'>, 'rows' | 'value'> & { value: string; 'aria-label': string }) {
  return (
    <div className="writing-surface-title">
      <span aria-hidden="true">{value + '\u200b'}</span>
      <textarea {...props} value={value} rows={1} />
    </div>
  );
}
