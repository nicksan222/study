/** @file Owns context intents within this feature. */

import { StudyError, noteContextIntentSchema, runSelectionContextSchema } from '@study/contracts';
import { and, eq, note_retired_intents, note_run_contexts } from '@study/db';
import { defineStore, storeQuery } from '@study/server';
import { Option, Schema } from 'effect';

import { makeContextReads } from './context-reads.ts';
import { canonicalIntent, intentCodec, sameIntent } from './context-schemas.ts';

export const NoteContextIntentStore = defineStore({
  name: 'study/NoteContextIntentStore',
  entity: { singular: 'noteContextIntent', plural: 'noteContextIntents' },
  make: (resources) => {
    const { db } = resources;

    const { decodeContext, assertContextAvailable } = makeContextReads(resources);

    return {
      queries: {
        findNoteContextIntent: storeQuery({
          role: 'optional',
          input: noteContextIntentSchema,
          output: Schema.Option(runSelectionContextSchema),
          run: (input) => {
            if (
              db.orm
                .select()
                .from(note_retired_intents)
                .where(
                  and(
                    eq(note_retired_intents.note_id, input.noteId),
                    eq(note_retired_intents.intent_key, input.intentKey)
                  )
                )
                .get()
            )
              throw new StudyError('not_found', 'Captured input history is unavailable');

            const row = db.orm
              .select()
              .from(note_run_contexts)
              .where(
                and(
                  eq(note_run_contexts.note_id, input.noteId),
                  eq(note_run_contexts.intent_key, input.intentKey)
                )
              )
              .get();

            if (!row) return Option.none();

            assertContextAvailable(row.request_id);

            if (
              !sameIntent(
                canonicalIntent(Schema.decodeUnknownSync(intentCodec)(row.intent)),
                canonicalIntent(input)
              )
            )
              throw new StudyError('invalid_input', 'Intent key already captures different work');

            return Option.some(decodeContext(row.snapshot));
          }
        })
      },
      mutations: {}
    };
  }
});
