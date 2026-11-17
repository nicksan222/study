/** @file Generates durable version-bound section titles independently of question classification. */

import {
  failureSchema,
  StudyError,
  noteSectionTitleRequestedSchema,
  sectionTitleTextSchema
} from '@study/contracts';
import {
  Database,
  defineWorkflow,
  defineWorkflowHandler,
  generateAgent,
  publicationActivity,
  resumableActivity
} from '@study/server';
import { Effect, Schema } from 'effect';

import { sectionTitleAgent } from '#server/features/notes/agents/section-title';
import { Notes } from '#server/features/notes/service/index';

import { ignoreUnavailableNoteContent } from './internal/unavailable.ts';

const noteSectionTitleWorkflow = defineWorkflow({
  name: 'note-section-title',
  version: 1,
  payload: Schema.Struct({ event: noteSectionTitleRequestedSchema }),
  success: Schema.Void,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

const noteSectionTitleHandler = ({ event }: typeof noteSectionTitleWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const database = yield* Database;
    const input = { messageId: event.messageId, expectedActiveVersionId: event.versionId };
    const title = yield* resumableActivity({
      name: 'generate-section-title',
      success: sectionTitleTextSchema,
      execute: function* () {
        const snapshot = yield* notes.sectionTitleSnapshot(input);

        if (snapshot.noteId !== event.noteId)
          return yield* Effect.fail(
            new StudyError('invalid_input', 'Section title event identity mismatch')
          );

        if (snapshot.title) return snapshot.title;

        const result = yield* generateAgent(
          sectionTitleAgent,
          { prompt: JSON.stringify({ text: snapshot.text }) },
          {
            maxRetries: 0,
            preflight: notes
              .sectionTitleSnapshot(input)
              .pipe(Effect.asVoid, Effect.provideService(Database, database))
          }
        );

        const title = result.trim();

        if (!title)
          return yield* Effect.fail(
            new StudyError('transient', 'Generated section title is empty')
          );

        return title;
      }
    });

    yield* publicationActivity(database.store, {
      name: 'publish-section-title',
      success: Schema.Void,
      execute: notes.publishSectionTitle({ ...input, title })
    });
  }).pipe(Effect.catch(ignoreUnavailableNoteContent));

export const noteSectionTitleRegistration = defineWorkflowHandler(noteSectionTitleWorkflow, {
  execute: noteSectionTitleHandler,
  triggers: [{ subscription: 'note-section-title', event: 'NoteSectionTitleRequested', emits: [] }]
});
