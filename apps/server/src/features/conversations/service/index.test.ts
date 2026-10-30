import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SessionId } from '@study/contracts/ids';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Option } from 'effect';

import { Projects } from '#server/features/projects/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { Conversations } from './index.ts';

test('sessions support normalized creation, bounded pagination and missing reads', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const database = Layer.succeed(Database, { store: context });
  const layer = Layer.merge(Projects.layer, Conversations.layer).pipe(Layer.provide(database));

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const conversations = yield* Conversations;
        const project = yield* projects.createProject({ name: 'Test' });
        const first = yield* conversations.createSession({ project: project.id, title: ' First ' });
        const second = yield* conversations.createSession({ project: project.id, title: 'Second' });

        assert.equal(first.title, 'First');
        assert.equal(first.titleSource, 'user');
        const page = yield* conversations.sessions({ limit: 1 });

        assert.equal(page.items[0]?.id, second.id);
        assert.deepEqual(page.next, { updatedAt: second.updatedAt, id: second.id });
        assert.equal(
          (yield* conversations.sessions({ limit: 1, before: page.next! })).items[0]?.id,
          first.id
        );
        const absent = 999n as SessionId;

        assert.ok(Option.isNone(yield* conversations.findSession(absent)));
        assert.equal((yield* Effect.flip(conversations.session(absent))).kind, 'not_found');
        assert.equal(
          (yield* Effect.flip(conversations.createSession({ project: project.id, title: ' ' })))
            .kind,
          'invalid_input'
        );
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('messages retain immutable versions and paginate in chronological order', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Layer.merge(Projects.layer, Conversations.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const conversations = yield* Conversations;
        const project = yield* projects.createProject({ name: 'Messages' });
        const session = yield* conversations.createSession({ project: project.id, title: 'Chat' });
        const first = yield* conversations.postMessage({ sessionId: session.id, text: ' first ' });
        const second = yield* conversations.postMessage({ sessionId: session.id, text: 'second' });
        const edited = yield* conversations.editMessage({ messageId: first.id, text: 'changed' });

        assert.deepEqual(
          edited.versions.map((v) => v.text),
          ['first', 'changed']
        );
        assert.equal(edited.versions[1]?.basedOn, first.activeVersionId);
        assert.equal(
          (yield* Effect.flip(
            conversations.setActiveVersion({
              messageId: second.id,
              versionId: edited.versions[0]!.id
            })
          )).kind,
          'invalid_input'
        );
        const restored = yield* conversations.setActiveVersion({
          messageId: first.id,
          versionId: first.activeVersionId!
        });

        assert.equal(restored.activeVersionId, first.activeVersionId);
        assert.deepEqual(
          (yield* conversations.thread({ sessionId: session.id, limit: 2 })).items.map((m) => m.id),
          [first.id, second.id]
        );
        const page = yield* conversations.thread({ sessionId: session.id, limit: 1 });

        assert.equal(page.items[0]?.id, second.id);
        assert.equal(page.next, second.id);
        assert.equal(
          (yield* conversations.thread({ sessionId: session.id, limit: 1, before: page.next! }))
            .items[0]?.id,
          first.id
        );
        assert.equal(yield* conversations.deleteMessage(first.id), true);
        assert.equal((yield* Effect.flip(conversations.message(first.id))).kind, 'not_found');
        const { message_versions } = yield* Effect.promise(() => import('@study/db/schema'));
        const { eq } = yield* Effect.promise(() => import('@study/db'));

        assert.equal(
          context.db.orm
            .select()
            .from(message_versions)
            .where(eq(message_versions.message_id, first.id))
            .all().length,
          0
        );
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('attachment snapshots enforce project ownership and survive source deletion', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Layer.merge(Projects.layer, Conversations.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const conversations = yield* Conversations;
        const project = yield* projects.createProject({ name: 'One' });
        const other = yield* projects.createProject({ name: 'Two' });
        const session = yield* conversations.createSession({ project: project.id, title: 'Chat' });
        const { sources } = yield* Effect.promise(() => import('@study/db/schema'));
        const { eq } = yield* Effect.promise(() => import('@study/db'));
        const source = (projectId: typeof project.id, name: string) =>
          context.db.orm
            .insert(sources)
            .values({
              project_id: projectId,
              origin: 'attachment',
              kind: 'text',
              mime: 'text/plain',
              name,
              size_bytes: 1n,
              sha256: Buffer.alloc(32),
              created_at: 1n
            })
            .returning()
            .get();
        const a = source(project.id, 'a.txt');
        const b = source(project.id, 'b.txt');
        const foreign = source(other.id, 'foreign.txt');

        assert.equal(
          (yield* Effect.flip(
            conversations.postMessage({
              sessionId: session.id,
              text: 'x',
              sourceIds: [foreign.id]
            })
          )).kind,
          'invalid_input'
        );
        assert.equal(
          (yield* conversations.thread({ sessionId: session.id, limit: 10 })).items.length,
          0
        );
        const message = yield* conversations.postMessage({
          sessionId: session.id,
          text: '',
          sourceIds: [b.id, a.id]
        });

        assert.deepEqual(
          message.parts.map((p) => p.sourceName),
          ['b.txt', 'a.txt']
        );
        context.db.orm.delete(sources).where(eq(sources.id, b.id)).run();
        const edited = yield* conversations.editMessage({ messageId: message.id, text: 'edited' });

        assert.deepEqual(
          edited.parts.map((p) => [p.sourceId, p.sourceName]),
          [
            [null, 'b.txt'],
            [a.id, 'a.txt']
          ]
        );
        assert.equal(yield* conversations.deleteSession(session.id), true);
        assert.equal((yield* Effect.flip(conversations.message(message.id))).kind, 'not_found');
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('editing and deleting messages update session ordering with a composite cursor', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Layer.merge(Projects.layer, Conversations.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const conversations = yield* Conversations;
        const project = yield* projects.createProject({ name: 'Order' });
        const first = yield* conversations.createSession({ project: project.id, title: 'First' });
        const second = yield* conversations.createSession({ project: project.id, title: 'Second' });
        const message = yield* conversations.postMessage({ sessionId: first.id, text: 'hello' });
        const { sessions } = yield* Effect.promise(() => import('@study/db/schema'));
        const { eq } = yield* Effect.promise(() => import('@study/db'));

        context.db.orm
          .update(sessions)
          .set({ updated_at: 1n })
          .where(eq(sessions.id, first.id))
          .run();
        context.db.orm
          .update(sessions)
          .set({ updated_at: 2n })
          .where(eq(sessions.id, second.id))
          .run();
        yield* conversations.editMessage({ messageId: message.id, text: 'new' });
        const page = yield* conversations.sessions({ limit: 1 });

        assert.equal(page.items[0]?.id, first.id);
        assert.equal(
          (yield* conversations.sessions({ limit: 1, before: page.next! })).items[0]?.id,
          second.id
        );
        context.db.orm
          .update(sessions)
          .set({ updated_at: 1n })
          .where(eq(sessions.id, first.id))
          .run();
        yield* conversations.deleteMessage(message.id);
        assert.equal((yield* conversations.sessions({ limit: 1 })).items[0]?.id, first.id);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('message validation rejects invalid text, incomplete versions, and foreign versions', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Layer.merge(Projects.layer, Conversations.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const conversations = yield* Conversations;
        const project = yield* projects.createProject({ name: 'Validation' });
        const session = yield* conversations.createSession({ project: project.id, title: 'Chat' });

        assert.equal(
          (yield* Effect.flip(conversations.postMessage({ sessionId: session.id, text: '  ' })))
            .kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(
            conversations.postMessage({ sessionId: session.id, text: '😀'.repeat(100001) })
          )).kind,
          'invalid_input'
        );
        const message = yield* conversations.postMessage({
          sessionId: session.id,
          text: '😀'.repeat(100000)
        });
        const { message_versions } = yield* Effect.promise(() => import('@study/db/schema'));
        const unfinished = context.db.orm
          .insert(message_versions)
          .values({
            message_id: message.id,
            number: 2n,
            origin: 'answer',
            status: 'pending',
            text: '',
            created_at: 1n
          })
          .returning()
          .get();

        assert.equal(
          (yield* Effect.flip(
            conversations.setActiveVersion({ messageId: message.id, versionId: unfinished.id })
          )).kind,
          'invalid_input'
        );
        assert.equal(
          (yield* conversations.message(message.id)).activeVersionId,
          message.activeVersionId
        );
        assert.equal(
          (yield* Effect.flip(conversations.editMessage({ messageId: message.id, text: ' ' })))
            .kind,
          'invalid_input'
        );
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('reply request persists its context and rejects another pending request', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Layer.merge(Projects.layer, Conversations.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const conversations = yield* Conversations;
        const project = yield* projects.createProject({ name: 'Reply' });
        const session = yield* conversations.createSession({ project: project.id, title: 'Chat' });
        const message = yield* conversations.postMessage({ sessionId: session.id, text: 'hello' });
        const request = yield* conversations.requestReply({ sessionId: session.id });
        const snapshot = yield* conversations.replySnapshot({ requestId: request.requestId });
        const { workflowEvents } = yield* Effect.promise(() => import('@study/db/schema'));
        const { decodeEvent } = yield* Effect.promise(
          () => import('#server/platform/workflows/events')
        );
        const events = context.db.orm.select().from(workflowEvents).all();

        assert.equal(events.length, 1);
        assert.deepEqual(decodeEvent(events[0]!.payload), {
          type: 'ConversationGenerationRequested',
          eventId: events[0]!.eventId,
          causationId: null,
          correlationId: request.requestId,
          inputVersion: 1,
          depth: 0,
          ...request,
          operation: 'reply'
        });
        const target = yield* conversations.message(request.messageId);

        assert.equal(target.activeVersionId, request.versionId);
        assert.equal(target.versions[0]?.status, 'pending');
        assert.equal(snapshot.messages[0]?.versionId, message.activeVersionId);
        assert.equal(snapshot.messages[0]?.text, 'hello');
        assert.equal(
          (yield* Effect.flip(conversations.requestReply({ sessionId: session.id }))).kind,
          'invalid_input'
        );
        yield* conversations.editMessage({ messageId: message.id, text: 'changed' });
        assert.equal(
          (yield* Effect.flip(conversations.replySnapshot({ requestId: request.requestId }))).kind,
          'invalid_input'
        );
        const replacement = yield* conversations.requestReply({ sessionId: session.id });

        assert.notEqual(replacement.requestId, request.requestId);
        assert.equal(
          (yield* conversations.replySnapshot({ requestId: replacement.requestId })).messages[0]
            ?.text,
          'changed'
        );
        const editedReply = yield* conversations.editMessage({
          messageId: replacement.messageId,
          text: 'Keep this complete edit'
        });
        const afterEdit = yield* conversations.requestReply({ sessionId: session.id });

        assert.equal(
          (yield* conversations.message(editedReply.id)).activeVersionId,
          editedReply.activeVersionId
        );
        assert.equal(
          (yield* conversations.replySnapshot({ requestId: afterEdit.requestId })).messages.at(-1)
            ?.text,
          'Keep this complete edit'
        );
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('reply snapshots retain historical attachments after reopen and reprocessing', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  const { sources, documents, source_processing } = await import('@study/db/schema');
  const { eq } = await import('@study/db');
  const layer = () =>
    Layer.merge(Projects.layer, Conversations.layer).pipe(
      Layer.provide(Layer.succeed(Database, { store: context }))
    );

  try {
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'History' });
        const conversations = yield* Conversations;
        const session = yield* conversations.createSession({ project: project.id, title: 'Chat' });
        const source = context.db.orm
          .insert(sources)
          .values({
            project_id: project.id,
            origin: 'attachment',
            kind: 'text',
            mime: 'text/plain',
            name: 'a.txt',
            size_bytes: 1n,
            sha256: Buffer.alloc(32),
            created_at: 1n
          })
          .returning()
          .get();
        const document = context.db.orm
          .insert(documents)
          .values({ source_id: source.id, extractor_version: 1n, meta: '{}', created_at: 1n })
          .returning()
          .get();

        context.db.orm
          .insert(source_processing)
          .values({
            source_id: source.id,
            revision: 1n,
            request_id: 'one',
            published_request_id: 'one',
            document_id: document.id
          })
          .run();
        const message = yield* conversations.postMessage({
          sessionId: session.id,
          text: 'hello',
          sourceIds: [source.id]
        });
        const edited = yield* conversations.editMessage({ messageId: message.id, text: 'new' });

        yield* conversations.setActiveVersion({
          messageId: message.id,
          versionId: message.activeVersionId!
        });
        const request = yield* conversations.requestReply({ sessionId: session.id });

        return { request, source, document, message, edited };
      }).pipe(Effect.provide(layer()))
    );

    context.close();
    context = new ServerContext(location.open());
    const newer = context.db.orm
      .insert(documents)
      .values({ source_id: saved.source.id, extractor_version: 1n, meta: '{}', created_at: 2n })
      .returning()
      .get();

    context.db.orm
      .update(source_processing)
      .set({ document_id: newer.id })
      .where(eq(source_processing.source_id, saved.source.id))
      .run();
    await Effect.runPromise(
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const snapshot = yield* conversations.replySnapshot({ requestId: saved.request.requestId });

        assert.equal(snapshot.messages[0]?.versionId, saved.message.activeVersionId);
        assert.equal(snapshot.messages[0]?.attachments[0]?.documentId, saved.document.id);
        assert.equal(snapshot.messages[0]?.attachments[0]?.sourceName, 'a.txt');
        yield* conversations.setActiveVersion({
          messageId: saved.message.id,
          versionId: saved.edited.activeVersionId!
        });
        yield* conversations.setActiveVersion({
          messageId: saved.message.id,
          versionId: saved.message.activeVersionId!
        });
        assert.equal(
          (yield* Effect.flip(conversations.replySnapshot({ requestId: saved.request.requestId })))
            .kind,
          'invalid_input'
        );
      }).pipe(Effect.provide(layer()))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('outbox failure rolls back reply request and pending message', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const { sql } = await import('@study/db');
  const { workflowEvents, conversation_reply_requests } = await import('@study/db/schema');
  const layer = Layer.merge(Projects.layer, Conversations.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Rollback' });
        const conversations = yield* Conversations;
        const session = yield* conversations.createSession({ project: project.id, title: 'Chat' });

        yield* conversations.postMessage({ sessionId: session.id, text: 'hello' });
        context.db.orm.run(
          sql`CREATE TRIGGER fail_reply_event BEFORE INSERT ON workflow_events BEGIN SELECT RAISE(ABORT, 'event failed'); END`
        );
        yield* Effect.flip(conversations.requestReply({ sessionId: session.id }));
        assert.equal(
          (yield* conversations.thread({ sessionId: session.id, limit: 10 })).items.length,
          1
        );
        assert.equal(context.db.orm.select().from(conversation_reply_requests).all().length, 0);
        assert.equal(context.db.orm.select().from(workflowEvents).all().length, 0);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('reply captures pending attachments and invalidates deleted context', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const { sources, documents, source_processing } = await import('@study/db/schema');
  const { eq } = await import('@study/db');
  const layer = Layer.merge(Projects.layer, Conversations.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Documents' });
        const other = yield* (yield* Projects).createProject({ name: 'Other' });
        const conversations = yield* Conversations;
        const session = yield* conversations.createSession({ project: project.id, title: 'Chat' });
        const source = context.db.orm
          .insert(sources)
          .values({
            project_id: project.id,
            origin: 'attachment',
            kind: 'text',
            mime: 'text/plain',
            name: 'a.txt',
            size_bytes: 1n,
            sha256: Buffer.alloc(32),
            created_at: 1n
          })
          .returning()
          .get();
        const message = yield* conversations.postMessage({
          sessionId: session.id,
          text: 'hello',
          sourceIds: [source.id]
        });

        context.db.orm
          .insert(source_processing)
          .values({
            source_id: source.id,
            revision: 1n,
            request_id: 'one'
          })
          .run();
        const request = yield* conversations.requestReply({ sessionId: session.id });
        const pending = yield* conversations.replySnapshot({ requestId: request.requestId });

        assert.equal(pending.pendingAttachments?.length, 1);
        assert.equal(pending.pendingAttachments?.[0]?.sourceId, source.id);
        const document = context.db.orm
          .insert(documents)
          .values({ source_id: source.id, extractor_version: 1n, meta: '{}', created_at: 1n })
          .returning()
          .get();

        context.db.orm
          .update(source_processing)
          .set({ document_id: document.id, published_request_id: 'one' })
          .where(eq(source_processing.source_id, source.id))
          .run();
        assert.throws(
          () =>
            context.db.orm
              .update(sources)
              .set({ project_id: other.id })
              .where(eq(sources.id, source.id))
              .run(),
          (error: unknown) =>
            error instanceof Error &&
            error.cause instanceof Error &&
            error.cause.message === 'attachment source project mismatch'
        );
        assert.equal(
          (yield* conversations.replyReadiness({ requestId: request.requestId })).length,
          0
        );
        context.db.orm
          .update(source_processing)
          .set({ request_id: 'replacement', revision: 2n })
          .where(eq(source_processing.source_id, source.id))
          .run();
        assert.equal(
          (yield* Effect.flip(conversations.replySnapshot({ requestId: request.requestId }))).kind,
          'invalid_input'
        );
        yield* conversations.deleteMessage(message.id);
        assert.equal(
          (yield* Effect.flip(conversations.replySnapshot({ requestId: request.requestId }))).kind,
          'not_found'
        );
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('reply history captures a bounded recent window and total text budget', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Layer.merge(Projects.layer, Conversations.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Bounded' });
        const conversations = yield* Conversations;
        const session = yield* conversations.createSession({
          project: project.id,
          title: 'History'
        });

        for (let i = 0; i < 60; i++)
          yield* conversations.postMessage({ sessionId: session.id, text: `message ${i}` });

        const request = yield* conversations.requestReply({ sessionId: session.id });
        const history = yield* conversations.replySnapshot({ requestId: request.requestId });

        assert.equal(history.messages.length, 50);
        assert.equal(history.messages[0]?.text, 'message 10');
        assert.equal(history.messages.at(-1)?.text, 'message 59');
        const largeSession = yield* conversations.createSession({
          project: project.id,
          title: 'Large'
        });

        for (let i = 0; i < 3; i++)
          yield* conversations.postMessage({
            sessionId: largeSession.id,
            text: String(i).repeat(80000)
          });

        const large = yield* conversations.requestReply({ sessionId: largeSession.id });
        const largeHistory = yield* conversations.replySnapshot({ requestId: large.requestId });

        assert.equal(largeHistory.messages.length, 2);
        assert.equal(largeHistory.messages[0]?.text[0], '1');
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('untitled sessions capture title requests and reject stale context', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Layer.merge(Projects.layer, Conversations.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const conversations = yield* Conversations;
        const { Settings } = yield* Effect.promise(() => import('#server/features/settings/index'));
        const project = yield* projects.createProject({ name: 'Title' });
        const session = yield* conversations
          .createUntitledSession({ project: project.id })
          .pipe(
            Effect.provide(
              Settings.layer.pipe(Layer.provide(Layer.succeed(Database, { store: context })))
            )
          );

        assert.equal(session.titleSource, 'provisional');
        assert.equal(session.title, 'New session');
        const settingsLayer = Settings.layer.pipe(
          Layer.provide(Layer.succeed(Database, { store: context }))
        );

        yield* Effect.gen(function* () {
          const settings = yield* Settings;

          yield* settings.saveAppSettings({
            language: 2,
            appearance: 2,
            zoomPercent: 100,
            onboarded: false
          });
        }).pipe(Effect.provide(settingsLayer));
        const italian = yield* conversations
          .createUntitledSession({ project: project.id })
          .pipe(Effect.provide(settingsLayer));

        assert.equal(italian.title, 'Nuova sessione');
        const message = yield* conversations.postMessage({
          sessionId: session.id,
          text: 'Study cells'
        });
        const request = yield* conversations.requestTitle({ sessionId: session.id });
        const snapshot = yield* conversations.titleSnapshot({ requestId: request.requestId });

        assert.equal(snapshot.messages[0]?.versionId, message.activeVersionId);
        assert.equal(snapshot.messages[0]?.text, 'Study cells');
        yield* conversations.editMessage({ messageId: message.id, text: 'Study plants' });
        assert.equal(
          (yield* Effect.flip(conversations.titleSnapshot({ requestId: request.requestId }))).kind,
          'invalid_input'
        );
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('title context selects the latest fifty messages within its text budget', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const { Settings } = await import('#server/features/settings/index');
  const layer = Layer.mergeAll(Projects.layer, Conversations.layer, Settings.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Bounded title' });
        const conversations = yield* Conversations;
        const session = yield* conversations.createUntitledSession({ project: project.id });

        for (let i = 0; i < 51; i++)
          yield* conversations.postMessage({ sessionId: session.id, text: `message ${i}` });

        const request = yield* conversations.requestTitle({ sessionId: session.id });
        const snapshot = yield* conversations.titleSnapshot({ requestId: request.requestId });

        assert.equal(snapshot.messages.length, 50);
        assert.equal(snapshot.messages[0]?.text, 'message 1');
        assert.equal(snapshot.messages[49]?.text, 'message 50');
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('titles respect the aggregate text budget and do not require ready attachment documents', async () => {
  const { Settings } = await import('#server/features/settings/index');
  const { Sources } = await import('#server/features/sources/index');
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const services = Layer.mergeAll(
    Projects.layer,
    Conversations.layer,
    Settings.layer,
    Sources.layer
  ).pipe(Layer.provide(Layer.succeed(Database, { store: context })));

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Title limits' });
        const conversations = yield* Conversations;
        const sources = yield* Sources;
        const source = yield* sources.createSource({
          name: 'notes.txt',
          bytes: new TextEncoder().encode('not indexed'),
          projectId: project.id
        });

        assert.equal((yield* sources.sourceProcessing(source.id)).documentId, null);
        const session = yield* conversations.createUntitledSession({ project: project.id });

        yield* conversations.postMessage({
          sessionId: session.id,
          text: 'Study this attachment',
          sourceIds: [source.id]
        });
        const pending = yield* conversations.requestTitle({ sessionId: session.id });

        assert.equal(
          (yield* conversations.titleSnapshot({ requestId: pending.requestId })).messages.length,
          1
        );
        const large = yield* conversations.createUntitledSession({ project: project.id });

        for (let i = 0; i < 3; i++)
          yield* conversations.postMessage({ sessionId: large.id, text: String(i).repeat(80000) });

        const request = yield* conversations.requestTitle({ sessionId: large.id });
        const captured = yield* conversations.titleSnapshot({ requestId: request.requestId });

        assert.equal(captured.messages.length, 2);
        assert.equal(captured.messages[0]?.text[0], '1');
        assert.equal(
          captured.messages.reduce((n, m) => n + m.text.length, 0),
          160000
        );
      }).pipe(Effect.provide(services))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('attachment threads are isolated, owned and paginated', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const { sources, documents, source_processing } = await import('@study/db/schema');
  const layer = Layer.merge(Projects.layer, Conversations.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Threads' });
        const conversations = yield* Conversations;
        const session = yield* conversations.createSession({ project: project.id, title: 'Chat' });
        const other = yield* conversations.createSession({ project: project.id, title: 'Other' });
        const source = context.db.orm
          .insert(sources)
          .values({
            project_id: project.id,
            origin: 'attachment',
            kind: 'text',
            mime: 'text/plain',
            name: 'a.txt',
            size_bytes: 1n,
            sha256: Buffer.alloc(32),
            created_at: 1n
          })
          .returning()
          .get();
        const document = context.db.orm
          .insert(documents)
          .values({ source_id: source.id, extractor_version: 1n, meta: '{}', created_at: 1n })
          .returning()
          .get();

        context.db.orm
          .insert(source_processing)
          .values({
            source_id: source.id,
            revision: 1n,
            request_id: 'one',
            published_request_id: 'one',
            document_id: document.id
          })
          .run();
        const root = yield* conversations.postMessage({
          sessionId: session.id,
          text: 'root',
          sourceIds: [source.id]
        });
        const part = root.parts[0]!.id;

        assert.equal(
          (yield* Effect.flip(
            conversations.postMessage({ sessionId: other.id, text: 'bad', threadRoot: part })
          )).kind,
          'invalid_input'
        );
        const one = yield* conversations.postMessage({
          sessionId: session.id,
          text: 'one',
          threadRoot: part
        });
        const two = yield* conversations.postMessage({
          sessionId: session.id,
          text: 'two',
          threadRoot: part
        });

        assert.deepEqual(
          (yield* conversations.thread({ sessionId: session.id, limit: 10 })).items.map(
            (m) => m.id
          ),
          [root.id]
        );
        const page = yield* conversations.thread({
          sessionId: session.id,
          threadRoot: part,
          limit: 1
        });

        assert.equal(page.items[0]?.id, two.id);
        assert.equal(
          (yield* conversations.thread({
            sessionId: session.id,
            threadRoot: part,
            limit: 1,
            before: page.next!
          })).items[0]?.id,
          one.id
        );
        const request = yield* conversations.requestReply({
          sessionId: session.id,
          threadRoot: part
        });
        const reply = yield* conversations.message(request.messageId);

        assert.equal(reply.threadRoot, part);
        assert.equal(reply.replyTo, two.id);
        const snapshot = yield* conversations.replySnapshot({ requestId: request.requestId });

        assert.deepEqual(
          snapshot.messages.map((m) => m.text),
          ['root', 'one', 'two']
        );
        assert.equal(snapshot.messages[0]?.attachments[0]?.partId, part);
        const { message_versions } = yield* Effect.promise(() => import('@study/db/schema'));
        const { eq } = yield* Effect.promise(() => import('@study/db'));

        context.db.orm
          .update(message_versions)
          .set({ status: 'complete', text: 'answer' })
          .where(eq(message_versions.id, request.versionId))
          .run();
        const reanswer = yield* conversations.reanswer({ messageId: request.messageId });
        const reanswerSnapshot = yield* conversations.replySnapshot({
          requestId: reanswer.requestId
        });

        assert.deepEqual(
          reanswerSnapshot.messages.map((m) => m.text),
          ['root', 'one', 'two']
        );
        assert.equal((yield* conversations.message(reanswer.messageId)).threadRoot, part);
        context.db.orm
          .update(message_versions)
          .set({ status: 'complete', text: 'another answer' })
          .where(eq(message_versions.id, reanswer.versionId))
          .run();
        const rewrite = yield* conversations.rewriteMessage({
          messageId: reanswer.messageId,
          origin: 'improve'
        });
        const rewriteSnapshot = yield* conversations.replySnapshot({
          requestId: rewrite.requestId
        });

        assert.deepEqual(
          rewriteSnapshot.messages.map((m) => m.text),
          ['root', 'one', 'two', 'another answer']
        );
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('posting a message can request a reply explicitly or by assistant mention', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Layer.merge(Projects.layer, Conversations.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Mention' });
        const conversations = yield* Conversations;
        const session = yield* conversations.createSession({ project: project.id, title: 'Chat' });
        const posted = yield* conversations.postMessage({
          sessionId: session.id,
          text: 'Please help',
          requestReply: true
        });
        const items = (yield* conversations.thread({ sessionId: session.id, limit: 10 })).items;

        assert.equal(items.length, 2);
        assert.equal(items[1]?.replyTo, posted.id);
        const second = yield* conversations.createSession({
          project: project.id,
          title: 'Mention'
        });
        const mention = yield* conversations.postMessage({
          sessionId: second.id,
          text: 'Hello @study!'
        });

        assert.equal(
          (yield* conversations.thread({ sessionId: second.id, limit: 10 })).items[1]?.replyTo,
          mention.id
        );
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
