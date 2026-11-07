/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies session tool isolation and versioned edits against real SQLite.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises forbidden reads, edits, detached content and deletion ownership.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use production feature services with temporary databases and no external model     │
 * │ requests.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createBlock } from '@study/contracts/sources/document';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Option } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { SessionDeletionCorrelationStore } from '#server/features/conversations/store/deletion';
import { Documents } from '#server/features/documents/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { useStore } from '#server/platform/definitions/define-store';

import { sessionAssistantTools } from './session-assistant.ts';

const environment = { language: 'en', searchSources: () => Effect.succeed([]) };

const body = (text: string) => ({
  blocks: [
    createBlock(
      { type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] },
      { type: 'authored' }
    )
  ],
  meta: {
    extractor: null,
    extractorVersion: 0,
    provider: null,
    durationMs: null,
    pageCount: null,
    refiners: [],
    waitingFor: [],
    corrected: false,
    omissions: []
  }
});

testStable(
  'session tools enforce scope for every note, document and source and preserve edit versions',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const docs = yield* Documents;
          const sources = yield* Sources;
          const a = yield* c.createSession({ title: 'Visible notebook' });
          const b = yield* c.createSession({ title: 'PRIVATE OTHER NOTEBOOK' });
          const note = yield* c.postMessage({ sessionId: a.id, text: 'Original note' });
          const otherNote = yield* c.postMessage({ sessionId: b.id, text: 'PRIVATE OTHER NOTE' });
          const document = yield* docs.create({
            createKey: 'visible',
            title: 'Visible document',
            document: body('Original body'),
            inputs: [],
            citations: [],
            sessionId: a.id
          });
          const otherDocument = yield* docs.create({
            createKey: 'other',
            title: 'PRIVATE OTHER DOCUMENT',
            document: body('PRIVATE BODY'),
            inputs: [],
            citations: [],
            sessionId: b.id
          });
          const source = yield* sources.createSource({
            name: 'private.txt',
            bytes: new TextEncoder().encode('PRIVATE SOURCE'),
            projectId: null
          });

          yield* sources.attachSource({ sessionId: b.id, sourceId: source.id });
          const tools = sessionAssistantTools(a.id);
          const initial = yield* tools.read_session_context.execute({}, environment);

          expect(initial.notes.items.map((item) => item.id)).toEqual([note.id]);
          expect(initial.documents.items.map((item) => item.id)).toEqual([document.id]);
          expect(initial.sources).toEqual([]);
          expect(Object.keys(tools)).not.toContain('read_settings');
          expect(Object.keys(tools)).not.toContain('list_sessions');
          expect(Object.keys(tools)).not.toContain('link_document_session');
          expect(
            (yield* Effect.flip(
              tools.edit_session_note.execute(
                {
                  messageId: otherNote.id,
                  expectedActiveVersionId: otherNote.activeVersionId!,
                  text: 'Wrong'
                },
                environment
              )
            )).kind
          ).toBe('not_found');
          expect(
            (yield* Effect.flip(tools.read_document.execute({ id: otherDocument.id }, environment)))
              .kind
          ).toBe('not_found');
          assert.ok(otherDocument.headVersionId);
          expect(
            (yield* Effect.flip(
              tools.save_document.execute(
                {
                  documentId: otherDocument.id,
                  expectedVersionId: otherDocument.headVersionId,
                  key: 'forbidden',
                  document: body('Wrong')
                },
                environment
              )
            )).kind
          ).toBe('not_found');
          expect(
            (yield* Effect.flip(tools.read_session_source.execute({ id: source.id }, environment)))
              .kind
          ).toBe('not_found');
          const edited = yield* tools.edit_session_note.execute(
            {
              messageId: note.id,
              expectedActiveVersionId: note.activeVersionId!,
              text: 'Improved note'
            },
            environment
          );

          expect(edited.versions.some((version) => version.text === 'Original note')).toBe(true);
          expect(
            edited.versions.find((version) => version.id === edited.activeVersionId)?.text
          ).toBe('Improved note');
          expect(
            (yield* Effect.result(
              tools.edit_session_note.execute(
                {
                  messageId: note.id,
                  expectedActiveVersionId: note.activeVersionId!,
                  text: 'Stale overwrite'
                },
                environment
              )
            ))._tag
          ).toBe('Failure');
          assert.ok(document.headVersionId);
          const saved = yield* tools.save_document.execute(
            {
              documentId: document.id,
              expectedVersionId: document.headVersionId,
              key: 'improve',
              document: body('Improved body')
            },
            environment
          );

          expect(saved.outcome).toBe('saved');
          expect((yield* docs.document({ id: otherDocument.id })).version?.document).toEqual(
            otherDocument.version!.document
          );
          yield* sources.attachSource({ sessionId: a.id, sourceId: source.id });
          expect(
            yield* tools.read_session_source.execute({ id: source.id }, environment)
          ).toBeNull();
          yield* sources.detachSource({ sessionId: a.id, sourceId: source.id });
          expect(
            (yield* Effect.flip(tools.read_session_source.execute({ id: source.id }, environment)))
              .kind
          ).toBe('not_found');
          yield* docs.detach({ documentId: document.id, sessionId: a.id });
          expect(
            (yield* Effect.flip(
              tools.save_document.execute(
                {
                  documentId: document.id,
                  expectedVersionId: saved.currentVersionId,
                  key: 'after-detach',
                  document: body('Wrong')
                },
                environment
              )
            )).kind
          ).toBe('not_found');
        }).pipe(
          Effect.provide(Conversations.layer),
          Effect.provide(Documents.layer),
          Effect.provide(Sources.layer),
          Effect.provideService(Database, { store: context })
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'deleting a notebook retires scoped chat correlations before cascading its private messages',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Conversations;
          const parent = yield* service.createSession({ title: 'Notebook' });
          const chat = yield* service.sessionAssistant({ sessionId: parent.id });
          const reply = yield* service.assistantAsk({
            sessionId: chat.id,
            text: 'PRIVATE CHAT CONTENT',
            intentKey: 'scoped-delete'
          });
          const other = yield* service.createSession({ title: 'Other' });
          const otherChat = yield* service.sessionAssistant({ sessionId: other.id });

          yield* service.deleteSession(parent.id);
          const correlations = yield* useStore(SessionDeletionCorrelationStore);

          expect((yield* correlations.deletionCorrelation(parent.id)).correlations).toContain(
            reply.requestId
          );
          expect(Option.isNone(yield* service.findSession(chat.id))).toBe(true);
          expect(Option.isSome(yield* service.findSession(otherChat.id))).toBe(true);
          expect(
            (yield* Effect.result(service.replySnapshot({ requestId: reply.requestId })))._tag
          ).toBe('Failure');
        }).pipe(
          Effect.provide(Conversations.layer),
          Effect.provideService(Database, { store: context })
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
