import { ComposerSurface } from '@study/ui/composer';
import { WorkspaceSurface } from '@study/ui/workspace';
import type { ComponentProps } from 'react';

import { ActionGroup } from './action-group';

function Root(props: Omit<ComponentProps<typeof WorkspaceSurface.Root>, 'variant' | 'className'>) {
  return <WorkspaceSurface.Root {...props} variant="welcome" className="note-start" />;
}

function Hint(props: Omit<ComponentProps<typeof ComposerSurface.Hint>, 'className'>) {
  return <ComposerSurface.Hint {...props} className="sr-only" />;
}

function Files(props: ComponentProps<'ul'>) {
  return <ul {...props} className="note-start-files" />;
}

function Attachment({ htmlFor, ...props }: ComponentProps<'label'> & { htmlFor: string }) {
  return <label {...props} htmlFor={htmlFor} className="note-file-button note-start-attach" />;
}

function Kind(props: ComponentProps<'span'>) {
  return <span {...props} className="note-start-kind" />;
}

function Recovery(props: ComponentProps<'section'>) {
  return <section {...props} className="note-start-recovery" />;
}

function Actions(props: ComponentProps<'div'>) {
  return <ActionGroup {...props} className="note-actions" />;
}

function Notes(props: ComponentProps<'ul'>) {
  return <ul {...props} className="note-list" />;
}

export const NoteStarter = {
  Root,
  Hint,
  Files,
  Attachment,
  Kind,
  Recovery,
  Actions,
  Notes
};
