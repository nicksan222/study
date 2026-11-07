/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes server-bound read and edit capabilities for one notebook.                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps every tool tied to the trusted session identity.                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Owning services enforce membership and optimistic version checks within their            │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import * as r from '@study/contracts/conversations/rpc';
import { chatMessageSchema } from '@study/contracts/conversations/schemas';
import * as e from '@study/contracts/documents/editing';
import * as d from '@study/contracts/documents/rpc';
import * as ds from '@study/contracts/documents/schemas';
import { messageIdSchema, sourceIdSchema, versionIdSchema } from '@study/contracts/ids';
import type { SessionId } from '@study/contracts/ids';
import * as sources from '@study/contracts/sources/rpc';
import { documentSchema } from '@study/contracts/sources/schemas';
import { Effect, Schema } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import { Sources } from '#server/features/sources/index';
import { defineTool } from '#server/platform/definitions/define-agent';

const documentSummary = Schema.Struct({
  id: ds.summarySchema.fields.id,
  title: Schema.String,
  headVersionId: ds.summarySchema.fields.headVersionId
});

const documentDetail = Schema.Struct({
  ...documentSummary.fields,
  document: Schema.NullOr(documentSchema)
});

const wiki = {
  when: 'Work with the current session only.',
  examples: ['Explain and improve the notes in this session.'] as const,
  limits: 'Scope is fixed by the server. No cross-session access.'
};

export function sessionAssistantTools(sessionId: SessionId) {
  const notebook = Effect.flatMap(Conversations, (service) => service.notebookSession(sessionId));
  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provide(Conversations.layer),
      Effect.provide(Documents.layer),
      Effect.provide(Sources.layer)
    );
  const history = Schema.Struct({
    limit: r.threadInputSchema.fields.limit,
    before: Schema.optional(messageIdSchema)
  });

  return {
    read_session_context: defineTool({
      description:
        'Read the current notebook title, latest notes and available documents and sources. Start here.',
      wiki,
      input: Schema.Record(Schema.String, Schema.Never),
      output: Schema.Struct({
        title: Schema.String,
        notes: r.threadPageSchema,
        documents: Schema.Struct({
          items: Schema.Array(documentSummary),
          nextCursor: ds.documentPageSchema.fields.nextCursor
        }),
        sources: Schema.Array(sources.sessionSourceSchema)
      }),
      mutates: false,
      execute: () =>
        provide(
          Effect.gen(function* () {
            const session = yield* notebook;
            const notes = yield* (yield* Conversations).thread({ sessionId, limit: 30 });
            const documents = yield* (yield* Documents).documents({
              sessionId,
              limit: 100,
              archived: false
            });
            const attached = yield* (yield* Sources).sessionSources({ sessionId, limit: 100 });

            return {
              title: session.title,
              notes,
              documents: {
                ...documents,
                items: documents.items.map(({ id, title, headVersionId }) => ({
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
    read_session_history: defineTool({
      description: 'Page older notes in this notebook, newest first.',
      wiki,
      input: history,
      output: r.threadPageSchema,
      mutates: false,
      execute: (input) =>
        provide(
          notebook.pipe(
            Effect.andThen(
              Effect.flatMap(Conversations, (service) => service.thread({ ...input, sessionId }))
            )
          )
        )
    }),
    edit_session_note: defineTool({
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
            const service = yield* Conversations;

            return yield* service.editSessionNote(sessionId, input);
          })
        )
    }),
    list_documents: defineTool({
      description: 'List authored documents linked to this notebook.',
      wiki,
      input: Schema.Struct({
        limit: d.listSchema.fields.limit,
        cursor: d.listSchema.fields.cursor
      }),
      output: Schema.Struct({
        items: Schema.Array(documentSummary),
        nextCursor: ds.documentPageSchema.fields.nextCursor
      }),
      mutates: false,
      execute: (input) =>
        provide(
          Effect.gen(function* () {
            yield* notebook;
            const page = yield* (yield* Documents).documents({
              ...input,
              sessionId,
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
    read_document: defineTool({
      description: 'Read the current anchored body of a document linked to this notebook.',
      wiki,
      input: Schema.Struct({ id: d.documentKeySchema.fields.id }),
      output: documentDetail,
      mutates: false,
      execute: (input) =>
        provide(
          Effect.gen(function* () {
            yield* notebook;
            const doc = yield* (yield* Documents).document({ ...input, sessionId });

            return {
              id: doc.id,
              title: doc.title,
              headVersionId: doc.headVersionId,
              document: doc.version?.document ?? null
            };
          })
        )
    }),
    save_document: defineTool({
      description:
        'Save a version of a linked authored document. Preserve block IDs. Version conflicts retain an alternative rather than overwriting.',
      wiki,
      input: e.saveSchema,
      output: e.editOutcomeSchema,
      mutates: true,
      execute: (input) =>
        provide(
          notebook.pipe(
            Effect.andThen(
              Effect.flatMap(Documents, (service) => service.saveInSession(sessionId, input))
            )
          )
        )
    }),
    list_session_sources: defineTool({
      description:
        'List attached sources, including extraction availability. Page using the last position.',
      wiki,
      input: Schema.Struct({
        limit: sources.sessionSourcesInputSchema.fields.limit,
        afterPosition: sources.sessionSourcesInputSchema.fields.afterPosition
      }),
      output: Schema.Array(sources.sessionSourceSchema),
      mutates: false,
      execute: (input) =>
        provide(
          notebook.pipe(
            Effect.andThen(
              Effect.flatMap(Sources, (service) => service.sessionSources({ ...input, sessionId }))
            )
          )
        )
    }),
    read_session_source: defineTool({
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

            return yield* (yield* Sources).sessionSourceExtraction({ sessionId, sourceId: id });
          })
        )
    })
  };
}
