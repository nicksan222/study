/** @file Owns context validity within this feature. */

import { replySnapshotInputSchema } from '@study/contracts';
import { eq, messages } from '@study/db';
import { defineStore, storeQuery } from '@study/server';
import { Schema } from 'effect';

import { makeContextReads } from './context-reads.ts';

/** Conservative validity for captured selection and active versions of relevant messages. */

export const NoteContextValidityStore = defineStore({
  name: 'study/NoteContextValidityStore',
  entity: { singular: 'noteContextValidity', plural: 'noteContextValidities' },
  make: (resources) => {
    const { db } = resources;

    const { requiredContext, note } = makeContextReads(resources);

    return {
      queries: {
        noteContextValidity: storeQuery({
          role: 'required',
          input: replySnapshotInputSchema,
          output: Schema.Boolean,
          run: ({ requestId }) => {
            const captured = requiredContext(requestId, true);

            const owner = note(captured.noteId);

            return (
              owner.selection_revision === captured.selectionRevision &&
              (captured.includedNotes ?? []).every(
                (item) => note(item.noteId).selection_revision === item.selectionRevision
              ) &&
              captured.messages.every(
                (item) =>
                  db.orm.select().from(messages).where(eq(messages.id, item.messageId)).get()
                    ?.active_version_id === item.versionId
              )
            );
          }
        })
      },
      mutations: {}
    };
  }
});
