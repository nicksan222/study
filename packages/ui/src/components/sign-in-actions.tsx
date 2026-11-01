import type { ReactNode } from 'react';

export function SignInActions({
  url,
  linkLabel,
  children
}: {
  url: string;
  linkLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <a
        className="text-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {linkLabel}
      </a>
      {children}
    </div>
  );
}
