import { noteIdSchema } from '@study/contracts/ids';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { Schema } from 'effect';

import { noteOptions } from '../features/note-workspace';
import { sidebarOwner } from '../lib/study-client/sidebar-owner.queries';
import { Page } from '../pages/notes/page';

export const Route = createFileRoute('/notes/$noteId')({
  staticData: {
    title: 'Notes',
    section: 'notes',
    scope: 'project',
    sidebar: {
      owner: sidebarOwner(noteIdSchema, ({ noteId }) => noteId, noteOptions)
    }
  },
  params: {
    parse: ({ noteId }) => {
      if (!/^[1-9][0-9]{0,18}$/.test(noteId)) throw notFound();

      const id = BigInt(noteId);

      if (!Schema.is(noteIdSchema)(id)) throw notFound();

      return { noteId: id };
    },
    stringify: ({ noteId }) => ({ noteId: String(noteId) })
  },
  component: Page
});
