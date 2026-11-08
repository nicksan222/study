/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes server-bound read and edit capabilities for one notebook.                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps every tool tied to the trusted note identity.                                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Owning services enforce membership and optimistic version checks within their            │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { messageIdSchema, sourceIdSchema, versionIdSchema } from '@study/contracts/ids';
import type { NoteId } from '@study/contracts/ids';
import * as r from '@study/contracts/notes/rpc';
import { chatMessageSchema } from '@study/contracts/notes/schemas';
import * as e from '@study/contracts/pages/editing';
import * as d from '@study/contracts/pages/rpc';
import * as ds from '@study/contracts/pages/schemas';
import * as sources from '@study/contracts/sources/rpc';
import { documentSchema } from '@study/contracts/sources/schemas';
import { Effect, Schema } from 'effect';

import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { Sources } from '#server/features/sources/index';
import { defineTool } from '#server/platform/definitions/define-agent';

const pageSummary = Schema.Struct({
  id: ds.summarySchema.fields.id,
  title: Schema.String,
  headVersionId: ds.summarySchema.fields.headVersionId
});

const pageDetail = Schema.Struct({
  ...pageSummary.fields,
  document: Schema.NullOr(documentSchema)
});

const wiki = {
  when: 'Work with the current note only.',
  examples: ['Explain and improve the notes in this note.'] as const,
  limits: 'Scope is fixed by the server. No cross-note access.'
};

export function noteAssistantTools(noteId: NoteId) {
  const notebook = Notes.use((service) => service.notebookNote(noteId));
  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provide(Notes.layer),
      Effect.provide(Pages.layer),
      Effect.provide(Sources.layer)
    );
  const history = Schema.Struct({
    limit: r.threadInputSchema.fields.limit,
    before: Schema.optional(messageIdSchema)
  });

  return {
    read_note_context: defineTool({
      description:
        'Read the current notebook title, latest notes and available pages and sources. Start here.',
      wiki,
      input: Schema.Record(Schema.String, Schema.Never),
      output: Schema.Struct({
        title: Schema.String,
        notes: r.threadPageSchema,
        pages: Schema.Struct({
          items: Schema.Array(pageSummary),
          nextCursor: ds.pageListSchema.fields.nextCursor
        }),
        sources: Schema.Array(sources.noteSourceSchema)
      }),
      mutates: false,
      execute: () =>
        provide(
          Effect.gen(function* () {
            const note = yield* notebook;
            const notes = yield* (yield* Notes).thread({ noteId, limit: 30 });
            const pages = yield* (yield* Pages).pages({
              noteId,
              limit: 100,
              archived: false
            });
            const attached = yield* (yield* Sources).noteSources({ noteId, limit: 100 });

            return {
              title: note.title,
              notes,
              pages: {
                ...pages,
                items: pages.items.map(({ id, title, headVersionId }) => ({
                  id,
                  title,
                  headVersionId
                }))
              },
              sources: attached
            };
          })
        )
    }),
    read_note_history: defineTool({
      description: 'Page older notes in this notebook, newest first.',
      wiki,
      input: history,
      output: r.threadPageSchema,
      mutates: false,
      execute: (input) =>
        provide(
          notebook.pipe(
            Effect.andThen(Notes.use((service) => service.thread({ ...input, noteId })))
          )
        )
    }),
    edit_note_message: defineTool({
      description:
        'Save a new version of an existing note in this notebook, with its exact last-read version.',
      wiki,
      input: Schema.Struct({
        messageId: messageIdSchema,
        expectedActiveVersionId: versionIdSchema,
        text: Schema.String.check(Schema.isMaxLength(100000))
      }),
      output: chatMessageSchema,
      mutates: true,
      execute: (input) =>
        provide(
          Effect.gen(function* () {
            yield* notebook;
            const service = yield* Notes;

            return yield* service.editNoteNote(noteId, input);
          })
        )
    }),
    list_pages: defineTool({
      description: 'List authored pages linked to this notebook.',
      wiki,
      input: Schema.Struct({
        limit: d.listSchema.fields.limit,
        cursor: d.listSchema.fields.cursor
      }),
      output: Schema.Struct({
        items: Schema.Array(pageSummary),
        nextCursor: ds.pageListSchema.fields.nextCursor
      }),
      mutates: false,
      execute: (input) =>
        provide(
          Effect.gen(function* () {
            yield* notebook;
            const page = yield* (yield* Pages).pages({
              ...input,
              noteId,
              archived: false
            });

            return {
              ...page,
              items: page.items.map(({ id, title, headVersionId }) => ({
                id,
                title,
                headVersionId
              }))
            };
          })
        )
    }),
    read_page: defineTool({
      description: 'Read the current anchored body of a page linked to this notebook.',
      wiki,
      input: Schema.Struct({ id: d.pageKeySchema.fields.id }),
      output: pageDetail,
      mutates: false,
      execute: (input) =>
        provide(
          Effect.gen(function* () {
            yield* notebook;
            const doc = yield* (yield* Pages).page({ ...input, noteId });

            return {
              id: doc.id,
              title: doc.title,
              headVersionId: doc.headVersionId,
              document: doc.version?.document ?? null
            };
          })
        )
    }),
    save_page: defineTool({
      description:
        'Save a version of a linked authored page. Preserve block IDs. Version conflicts retain an alternative rather than overwriting.',
      wiki,
      input: e.saveSchema,
      output: e.editOutcomeSchema,
      mutates: true,
      execute: (input) =>
        provide(
          notebook.pipe(Effect.andThen(Pages.use((service) => service.saveInNote(noteId, input))))
        )
    }),
    list_note_sources: defineTool({
      description:
        'List attached sources, including extraction availability. Page using the last position.',
      wiki,
      input: Schema.Struct({
        limit: sources.noteSourcesInputSchema.fields.limit,
        afterPosition: sources.noteSourcesInputSchema.fields.afterPosition
      }),
      output: Schema.Array(sources.noteSourceSchema),
      mutates: false,
      execute: (input) =>
        provide(
          notebook.pipe(
            Effect.andThen(Sources.use((service) => service.noteSources({ ...input, noteId })))
          )
        )
    }),
    read_note_source: defineTool({
      description:
        'Read the latest extraction of an attached source. Null means its extraction is not available.',
      wiki,
      input: Schema.Struct({ id: sourceIdSchema }),
      output: Schema.NullOr(sources.exactExtractionSchema),
      mutates: false,
      execute: ({ id }) =>
        provide(
          Effect.gen(function* () {
            yield* notebook;

            return yield* (yield* Sources).noteSourceExtraction({ noteId, sourceId: id });
          })
        )
    })
  };
}
