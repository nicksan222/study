/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies atomic manual merges preserve independent notebook content and originals. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves copied content and original notebook ownership.                              │
 * │ - Verifies or enforces atomic merge identity and persistence.                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Conversation stores retain private persistence behind typed transaction participants.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { expect } from 'vite-plus/test';

import { Documents } from '#server/features/documents/index';
import { Projects } from '#server/features/projects/index';
import { Recordings } from '#server/features/recordings/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { deletionDocument } from '#testing/material-deletion';

import { Conversations } from './index.ts';

testStable(
  'merges independent message histories, archives originals, and queues the title atomically',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Layer.mergeAll(Conversations.layer, Settings.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const first = yield* c.createSession({ title: 'First' });
          const second = yield* c.createSession({ title: 'Second' });
          const note = yield* c.postMessage({
            sessionId: first.id,
            text: 'Original',
            requestReply: false
          });

          yield* c.editMessage({ messageId: note.id, text: 'Edited' });
          yield* c.postMessage({ sessionId: second.id, text: 'Other', requestReply: false });
          const merged = yield* c.mergeSessions({
            sessionIds: [first.id, second.id],
            intentKey: 'merge-test'
          });

          expect(merged.id).not.toBe(first.id);
          expect(merged.archivedAt).toBeNull();
          expect((yield* c.session(first.id)).archivedAt).not.toBeNull();
          expect((yield* c.session(second.id)).archivedAt).not.toBeNull();
          const history = (yield* c.thread({ sessionId: merged.id, limit: 100 })).items;

          expect(history.flatMap((m) => m.versions).map((v) => v.text)).toEqual([
            'Original',
            'Edited',
            'Other'
          ]);
          expect(history[0]!.id).not.toBe(note.id);
          yield* c.editMessage({ messageId: history[0]!.id, text: 'Merged edit' });
          expect((yield* c.message(note.id)).versions.at(-1)?.text).toBe('Edited');
          const replay = yield* c.mergeSessions({
            sessionIds: [first.id, second.id],
            intentKey: 'merge-test'
          });

          expect(replay.id).toBe(merged.id);
          expect((yield* c.sessions({ limit: 100 })).items).toHaveLength(3);
          expect(
            context.db.orm.all<{ count: bigint }>(
              sql`SELECT count(*) AS count FROM workflow_events WHERE type='ConversationTitleRequested' AND json_extract(payload, '$.sessionId')=${String(merged.id)}`
            )[0]?.count
          ).toBe(1n);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable('failed merges roll back copies and archiving, and reject changed intents', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Layer.mergeAll(Conversations.layer, Settings.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Conversations;
        const first = yield* c.createSession({ title: 'First' });
        const second = yield* c.createSession({ title: 'Second' });

        yield* c.postMessage({ sessionId: first.id, text: 'Stable', requestReply: false });
        const pending = yield* c.postMessage({
          sessionId: second.id,
          text: 'Question',
          requestReply: true
        });

        expect(
          (yield* Effect.flip(
            c.mergeSessions({ sessionIds: [first.id, second.id], intentKey: 'failed' })
          )).kind
        ).toBe('invalid_input');
        expect((yield* c.sessions({ limit: 100 })).items).toHaveLength(2);
        expect((yield* c.session(first.id)).archivedAt).toBeNull();
        expect((yield* c.session(second.id)).archivedAt).toBeNull();
        expect(
          (yield* Effect.flip(
            c.mergeSessions({ sessionIds: [first.id, first.id], intentKey: 'duplicate' })
          )).kind
        ).toBe('invalid_input');
        yield* c.deleteMessage(pending.id);
        const merged = yield* c.mergeSessions({
          sessionIds: [second.id, first.id],
          intentKey: 'retry'
        });

        expect(
          (yield* c.mergeSessions({ sessionIds: [first.id, second.id], intentKey: 'retry' })).id
        ).toBe(merged.id);
        const third = yield* c.createSession({ title: 'Third' });

        expect(
          (yield* Effect.flip(
            c.mergeSessions({ sessionIds: [first.id, third.id], intentKey: 'retry' })
          )).kind
        ).toBe('invalid_input');
        expect(
          (yield* Effect.flip(
            c.mergeSessions({ sessionIds: [first.id, third.id], intentKey: 'new' })
          )).kind
        ).toBe('invalid_input');
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable(
  'copies attachment memberships once, keeps active links, and preserves attachments-only sessions',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Layer.mergeAll(
      Conversations.layer,
      Settings.layer,
      Documents.layer,
      Sources.layer,
      Recordings.layer,
      Projects.layer
    ).pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const docs = yield* Documents;
          const project = yield* (yield* Projects).createProject({ name: 'Biology' });
          const first = yield* c.createSession({ title: 'First', project: project.id });
          const second = yield* c.createSession({ title: 'Second' });
          const source = yield* (yield* Sources).createSource({
            name: 'notes.txt',
            bytes: new TextEncoder().encode('Evidence'),
            projectId: null
          });
          const firstMessage = yield* c.postMessage({
            sessionId: first.id,
            text: '',
            sourceIds: [source.id],
            requestReply: false
          });

          yield* c.postMessage({
            sessionId: second.id,
            text: '',
            sourceIds: [source.id],
            requestReply: false
          });
          const doc = yield* docs.create({
            sessionId: first.id,
            createKey: randomUUID(),
            title: 'Evidence',
            inputs: [],
            citations: [],
            document: deletionDocument('Evidence')
          });

          yield* docs.attach({ sessionId: second.id, documentId: doc.id });
          yield* c.setItemArchived({
            sessionId: first.id,
            target: { kind: 'document', id: doc.id },
            archived: true
          });
          yield* c.setItemArchived({
            sessionId: first.id,
            target: { kind: 'source', id: source.id },
            archived: true
          });
          const recordings = yield* Recordings;
          const recording = yield* recordings.createRecording(first.id);

          yield* recordings.appendRecording({ id: recording.id, samples: [1, 2, 3] });
          expect(
            (yield* Effect.flip(
              c.mergeSessions({ sessionIds: [first.id, second.id], intentKey: 'recording-pending' })
            )).kind
          ).toBe('invalid_input');
          yield* recordings.deleteRecording(recording.id);
          const merged = yield* c.mergeSessions({
            sessionIds: [first.id, second.id],
            intentKey: 'attachments'
          });

          expect(merged.projectIds).toEqual([project.id]);
          const messages = (yield* c.thread({ sessionId: merged.id, limit: 100 })).items;

          expect(messages).toHaveLength(2);
          expect(messages.every((message) => message.parts[0]?.sourceId === source.id)).toBe(true);
          expect((yield* c.message(firstMessage.id)).parts).toHaveLength(0);
          expect(
            (yield* docs.documents({
              sessionId: merged.id,
              archived: false,
              limit: 100
            })).items.map((document) => document.id)
          ).toEqual([doc.id]);
          expect(
            (yield* c.archivedItems({ sessionId: first.id })).some(
              (item) => item.target.kind === 'document' && item.target.id === doc.id
            )
          ).toBe(true);
          const empty = yield* c.createSession({ title: 'Empty' });
          const documentsOnly = yield* c.createSession({ title: 'Documents only' });

          yield* docs.attach({ sessionId: documentsOnly.id, documentId: doc.id });
          expect(
            (yield* c.mergeSessions({
              sessionIds: [empty.id, documentsOnly.id],
              intentKey: 'no-messages'
            })).title
          ).toBe('Empty · Documents only');
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'merges histories larger than the title context window without losing messages',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Layer.mergeAll(Conversations.layer, Settings.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const first = yield* c.createSession({ title: 'First' });
          const second = yield* c.createSession({ title: 'Second' });

          for (const sessionId of [first.id, first.id, second.id])
            yield* c.postMessage({ sessionId, text: 'a'.repeat(90000), requestReply: false });

          const merged = yield* c.mergeSessions({
            sessionIds: [first.id, second.id],
            intentKey: 'large'
          });
          const messages = (yield* c.thread({ sessionId: merged.id, limit: 100 })).items;

          expect(messages).toHaveLength(3);
          expect(messages.every((message) => message.versions[0]?.text.length === 90000)).toBe(
            true
          );
          const input = {
            sessionId: merged.id,
            intentKey: 'merged-context',
            instruction: '',
            preferences: {}
          };
          const captured = yield* c.captureSessionContext(input);

          expect(captured.messages.map((message) => message.messageId)).toEqual(
            messages.slice(-2).map((message) => message.id)
          );
          expect(captured.excludedMessages).toBe(1);
          const boundary = yield* c.captureSessionContext({
            ...input,
            intentKey: 'merged-boundary',
            throughMessageId: messages[0]!.id
          });

          expect(boundary.messages.map((message) => message.messageId)).toEqual([messages[0]!.id]);
          const foreign = (yield* c.thread({ sessionId: first.id, limit: 100 })).items[0]!;

          expect(
            (yield* Effect.flip(
              c.captureSessionContext({
                ...input,
                intentKey: 'foreign-boundary',
                throughMessageId: foreign.id
              })
            )).kind
          ).toBe('invalid_input');
          const extra = yield* c.createSession({ title: 'Additional context' });

          yield* c.postMessage({
            sessionId: extra.id,
            text: 'b'.repeat(30000),
            requestReply: false
          });
          expect(
            (yield* Effect.flip(
              c.captureSessionContext({
                ...input,
                intentKey: 'combined-budget',
                additionalSessionIds: [extra.id]
              })
            )).kind
          ).toBe('not_enough');
          const transform = yield* c.requestDocumentTransform({
            contextRequestId: captured.requestId,
            title: 'Merged notes',
            operations: ['structure']
          });

          expect(transform.sessionId).toBe(merged.id);
          const asked = yield* c.ask({
            sessionId: merged.id,
            intentKey: 'merged-ask',
            expectedSelectionRevision: 0n,
            text: 'Summarize the recent notes'
          });
          const askContext = yield* c.inspectSessionContext({ requestId: asked.requestId });

          expect(askContext.messages.at(-1)?.messageId).toBe(asked.userMessageId);
          expect(askContext.excludedMessages).toBe(1);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
