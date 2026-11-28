import type { ComponentProps } from 'react';

import { ActionGroup } from './action-group';
import { ComposerSurface } from './composer.tsx';
import { WorkspaceSurface } from './workspace.tsx';

function Root(props: Omit<ComponentProps<typeof WorkspaceSurface.Root>, 'variant' | 'className'>) {
  return <WorkspaceSurface.Root {...props} variant="welcome" className="note-start" />;
}

function Hint(props: Omit<ComponentProps<typeof ComposerSurface.Hint>, 'className'>) {
  return <ComposerSurface.Hint {...props} className="sr-only" />;
}

function Kind(props: ComponentProps<'span'>) {
  return <span {...props} className="note-start-kind" />;
}

function Recovery(props: ComponentProps<'section'>) {
  return <section {...props} className="note-start-recovery" />;
}

function Feedback(props: ComponentProps<'div'>) {
  return <div {...props} className="note-start-feedback" />;
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
  Kind,
  Recovery,
  Feedback,
  Actions,
  Notes
};
