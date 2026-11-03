import type { ComponentProps } from 'react';

function Introduction(props: ComponentProps<'p'>) {
  return <p {...props} className="mb-4 text-sm text-muted-foreground" />;
}

function NameForm(props: ComponentProps<'form'>) {
  return <form {...props} className="flex min-w-0 items-center gap-2" />;
}

export const SubjectSettings = { Introduction, NameForm };
