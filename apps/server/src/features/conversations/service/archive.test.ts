import { randomUUID } from 'node:crypto';

import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import { Sources } from '#server/features/sources/index';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';

testStable(
  'automatically includes active session items, archives reversibly, and preserves captured requests',
  async () => {
    const f = await documentTransformFixture();
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          const documents = yield* Documents;
          const first = yield* conversations.createSession({ title: 'First' });
          const second = yield* conversations.createSession({ title: 'Other' });
          const note = yield* conversations.postMessage({
            sessionId: first.id,
            text: 'Session note',
            requestReply: false
          });
          const doc = yield* documents.create({
            sessionId: first.id,
            createKey: randomUUID(),
            title: 'Shared document',
            inputs: [],
            citations: [],
            document: deletionDocument('Document evidence')
          });
          yield* documents.attach({ sessionId: second.id, documentId: doc.id });
          const capture = () =>
            conversations.captureSessionContext({
              sessionId: first.id,
              intentKey: randomUUID(),
              instruction: '',
              preferences: {}
            });
          const before = yield* capture();
          expect(before.messages.map((x) => x.text)).toEqual(['Session note']);
          expect(before.inputs.map((x) => x.name)).toEqual(['Shared document']);

          yield* conversations.setItemArchived({
            sessionId: first.id,
            target: { kind: 'message', id: note.id },
            archived: true
          });
          yield* conversations.setItemArchived({
            sessionId: first.id,
            target: { kind: 'document', id: doc.id },
            archived: true
          });
          expect(
            (yield* conversations.thread({ sessionId: first.id, limit: 30 })).items
          ).toHaveLength(0);
          expect(
            (yield* documents.documents({ sessionId: first.id, archived: false, limit: 30 })).items
          ).toHaveLength(0);
          expect(
            (yield* documents.documents({ sessionId: second.id, archived: false, limit: 30 })).items
          ).toHaveLength(1);
          expect(
            (yield* conversations.archivedItems({ sessionId: first.id }))
              .map((x) => x.target.kind)
              .sort()
          ).toEqual(['document', 'message']);
          const empty = yield* Effect.flip(capture());
          expect(empty.kind).toBe('invalid_input');
          expect(
            (yield* conversations.inspectSessionContext({
              requestId: before.requestId
            })).messages.map((x) => x.text)
          ).toEqual(['Session note']);

          yield* conversations.setItemArchived({
            sessionId: first.id,
            target: { kind: 'message', id: note.id },
            archived: false
          });
          yield* conversations.setItemArchived({
            sessionId: first.id,
            target: { kind: 'document', id: doc.id },
            archived: false
          });
          expect(yield* conversations.archivedItems({ sessionId: first.id })).toHaveLength(0);
          expect((yield* capture()).inputs).toHaveLength(1);

          yield* conversations.setItemArchived({
            sessionId: first.id,
            target: { kind: 'message', id: note.id },
            archived: true
          });
          yield* conversations.deleteMessage(note.id);
          expect(yield* conversations.archivedItems({ sessionId: first.id })).toHaveLength(0);
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'source archive is session-scoped and pending active material is never silently omitted',
  async () => {
    const f = await documentTransformFixture();
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          const sources = yield* Sources;
          const first = yield* conversations.createSession({ title: 'First' });
          const second = yield* conversations.createSession({ title: 'Second' });
          const source = yield* sources.createSource({
            name: 'evidence.txt',
            bytes: new TextEncoder().encode('Evidence'),
            projectId: null
          });
          yield* conversations.postMessage({
            sessionId: first.id,
            text: '',
            sourceIds: [source.id],
            requestReply: false
          });
          yield* conversations.postMessage({
            sessionId: second.id,
            text: '',
            sourceIds: [source.id],
            requestReply: false
          });
          yield* conversations.setItemArchived({
            sessionId: first.id,
            target: { kind: 'source', id: source.id },
            archived: true
          });
          expect(
            (yield* conversations.thread({ sessionId: first.id, limit: 30 })).items[0]?.parts
          ).toHaveLength(0);
          expect(
            (yield* conversations.thread({ sessionId: second.id, limit: 30 })).items[0]?.parts
          ).toHaveLength(1);
          expect((yield* sources.source(source.id)).id).toBe(source.id);
          expect((yield* conversations.archivedItems({ sessionId: first.id }))[0]?.target).toEqual({
            kind: 'source',
            id: source.id
          });
          yield* conversations.captureSessionContext({
            sessionId: first.id,
            intentKey: 'archived',
            instruction: '',
            preferences: {}
          });
          yield* conversations.setItemArchived({
            sessionId: first.id,
            target: { kind: 'source', id: source.id },
            archived: false
          });
          const failure = yield* Effect.flip(
            conversations.captureSessionContext({
              sessionId: first.id,
              intentKey: 'restored-pending',
              instruction: '',
              preferences: {}
            })
          );
          expect(failure.kind).toBe('not_enough');
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);

testStable('archive mutation rejects an item owned by another session', async () => {
  const f = await documentTransformFixture();
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const first = yield* conversations.createSession({ title: 'First' });
        const second = yield* conversations.createSession({ title: 'Second' });
        const note = yield* conversations.postMessage({
          sessionId: second.id,
          text: 'Other session',
          requestReply: false
        });
        const failure = yield* Effect.flip(
          conversations.setItemArchived({
            sessionId: first.id,
            target: { kind: 'message', id: note.id },
            archived: true
          })
        );
        expect(failure.kind).toBe('not_found');
        expect(
          (yield* conversations.thread({ sessionId: second.id, limit: 30 })).items
        ).toHaveLength(1);
      }).pipe(Effect.provide(f.domain()))
    );
  } finally {
    await f.close();
  }
});

testStable('empty archives load and bounded reads retain every archived item', async () => {
  const f = await documentTransformFixture();
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const session = yield* conversations.createSession({ title: 'Archive pages' });
        expect(yield* conversations.archivedItems({ sessionId: session.id })).toEqual([]);
        const ids = [];
        for (let i = 0; i < 101; i++) {
          const note = yield* conversations.postMessage({
            sessionId: session.id,
            text: 'Archived note ' + i,
            requestReply: false
          });
          ids.push(note.id);
          yield* conversations.setItemArchived({
            sessionId: session.id,
            target: { kind: 'message', id: note.id },
            archived: true
          });
        }
        const items = yield* conversations.archivedItems({ sessionId: session.id });
        expect(items).toHaveLength(101);
        expect(new Set(items.map((item) => item.target.id))).toEqual(new Set(ids));
      }).pipe(Effect.provide(f.domain()))
    );
  } finally {
    await f.close();
  }
});
