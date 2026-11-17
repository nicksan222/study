/** @file Persists generated section names separately from immutable content and manual descriptions. */

import {
  StudyError,
  messageIdSchema,
  noteIdSchema,
  versionIdSchema,
  sectionTitleTextSchema
} from '@study/contracts';
import {
  and,
  eq,
  isNull,
  message_section_titles,
  message_versions,
  messages,
  notes,
  sql,
  workflowEvents
} from '@study/db';
import { defineStore, storeMutation, storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { activeMessageCondition } from './archive.ts';

export const sectionTitleInputSchema = Schema.Struct({
  messageId: messageIdSchema,
  expectedActiveVersionId: versionIdSchema
});

export const publishSectionTitleInputSchema = Schema.Struct({
  ...sectionTitleInputSchema.fields,
  title: sectionTitleTextSchema
});

function makeCurrent({ db }: Pick<StoreResources, 'db'>) {
  return (input: typeof sectionTitleInputSchema.Type) => {
    const row = db.orm
      .select({ message: messages, version: message_versions })
      .from(messages)
      .innerJoin(message_versions, eq(message_versions.id, messages.active_version_id))
      .innerJoin(notes, eq(notes.id, messages.note_id))
      .where(
        and(
          eq(messages.id, input.messageId),
          eq(message_versions.id, input.expectedActiveVersionId),
          eq(message_versions.message_id, messages.id),
          eq(message_versions.status, 'complete'),
          eq(messages.format, 'text'),
          eq(notes.mode, 'notebook'),
          isNull(notes.archived_at),
          activeMessageCondition(),
          sql`${message_versions.text} <> ''`,
          sql`NOT EXISTS (SELECT 1 FROM note_deletions d WHERE d.note_id=${notes.id})`
        )
      )
      .get();

    return row;
  };
}

export const SectionTitleStore = defineStore({
  name: 'study/NoteSectionTitleStore',
  entity: { singular: 'sectionTitleSnapshot', plural: 'sectionTitleSnapshots' },
  make: (resources) => {
    const { db } = resources;
    const current = makeCurrent(resources);

    return {
      queries: {
        sectionTitleEligible: storeQuery({
          role: 'required',
          input: sectionTitleInputSchema,
          output: Schema.Boolean,
          run: (input) => !!current(input)
        }),
        sectionTitleSnapshot: storeQuery({
          role: 'required',
          input: sectionTitleInputSchema,
          output: Schema.Struct({
            noteId: noteIdSchema,
            text: Schema.String,
            title: Schema.NullOr(sectionTitleTextSchema),
            requestEventIds: Schema.Array(Schema.String)
          }),
          run: (input) => {
            const value = current(input);

            if (!value)
              throw new StudyError('invalid_input', 'Section title version is unavailable');

            const { message, version } = value;
            const title = db.orm
              .select()
              .from(message_section_titles)
              .where(eq(message_section_titles.version_id, version.id))
              .get();
            const events = db.orm
              .select({ id: workflowEvents.eventId })
              .from(workflowEvents)
              .where(
                and(
                  eq(workflowEvents.type, 'NoteSectionTitleRequested'),
                  eq(workflowEvents.correlationId, `section-title/${input.messageId}/${version.id}`)
                )
              )
              .all();

            return {
              noteId: message.note_id,
              text: version.text,
              title: title?.title ?? null,
              requestEventIds: events.map((event) => event.id)
            };
          }
        })
      },
      mutations: {
        publishSectionTitle: storeMutation({
          changes: ['notes'],
          input: publishSectionTitleInputSchema,
          output: Schema.Void,
          run: (input) => {
            if (!current(input))
              throw new StudyError('invalid_input', 'Section title version is unavailable');

            const title = input.title.trim();

            if (!title) throw new StudyError('invalid_input', 'Generated section title is empty');

            db.orm
              .insert(message_section_titles)
              .values({ version_id: input.expectedActiveVersionId, title })
              .onConflictDoNothing({ target: message_section_titles.version_id })
              .run();
          }
        })
      }
    };
  }
});
