/** @file Composes notes persistence with canonical typed store declarations. */

import { defineStore } from '@study/server';

import { makeNoteStore } from './notes.ts';

export const NoteStore = defineStore({
  name: 'study/NoteNoteStore',
  entity: { singular: 'note', plural: 'notes' },
  make: (resources) => makeNoteStore(resources)
});
