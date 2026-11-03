import type { ComponentProps } from 'react';

function Form(props: ComponentProps<'form'>) {
  return <form {...props} className="space-y-5 px-6 pb-6" />;
}

function Preview(props: ComponentProps<'div'>) {
  return <div {...props} className="flex items-center gap-3" />;
}

function Name(props: ComponentProps<'span'>) {
  return <span {...props} className="min-w-0 break-words text-sm font-medium" />;
}

function Modes({ label, ...props }: ComponentProps<'div'> & { label: string }) {
  return <div {...props} role="group" aria-label={label} className="flex flex-wrap gap-1" />;
}

function Field(props: ComponentProps<'div'>) {
  return <div {...props} className="space-y-2" />;
}

function Choices(props: ComponentProps<'div'>) {
  return <div {...props} className="space-y-3" />;
}

function Color({ color }: { color: string }) {
  return <span className="ui-icon-color" data-color={color} />;
}

function Empty(props: ComponentProps<'p'>) {
  return <p {...props} role="status" className="text-sm text-muted-foreground" />;
}

function Help(props: ComponentProps<'p'>) {
  return <p {...props} className="text-xs text-muted-foreground" />;
}

export const IdentityEditor = { Form, Preview, Name, Modes, Field, Choices, Color, Empty, Help };
