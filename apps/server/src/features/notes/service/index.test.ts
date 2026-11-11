/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Covers note and message pagination, immutable versions, attachment ownership       │
 * │ and snapshots, reply and title context limits, outbox rollback, thread isolation,        │
 * │ validation, and explicit or mention-triggered replies.                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises pagination, ownership fences, captured context, and atomic outbox behavior.  │
 * │ - Uses database fixtures to verify service-visible invariants and failures.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite uses real SQLite fixtures and service dependencies; domain state remains owned │
 * │ by the feature implementation.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { NoteId } from '@study/contracts/ids';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Option } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Pages } from '#server/features/pages/index';
import { Projects } from '#server/features/projects/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { deletionDocument } from '#testing/material-deletion';
import { withTestPublication } from '#testing/publication';

import { Notes } from './index.ts';

testStable('notes support normalized creation, bounded pagination and missing reads', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const database = Layer.succeed(Database, { store: context });
  const layer = Layer.merge(Projects.layer, Notes.layer).pipe(Layer.provideMerge(database));

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const notes = yield* Notes;
        const project = yield* projects.createProject({ name: 'Test' });
        const first = yield* notes.createNote({
          project: project.id,
          title: ' First '
        });
        const second = yield* notes.createNote({
          project: project.id,
          title: 'Second'
        });

        assert.ok(first.title === 'First');
        assert.ok(first.titleSource === 'user');
        const page = yield* notes.notes({ limit: 1 });

        assert.strictEqual(page.items[0]?.id, second.id);
        expect(page.next).toStrictEqual({ updatedAt: second.updatedAt, id: second.id });
        assert.strictEqual(
          (yield* notes.notes({ limit: 1, before: page.next! })).items[0]?.id,
          first.id
        );
        const global = yield* notes.createNote({ title: 'Projectless' });

        expect(
          (yield* notes.notes({ limit: 1, project: project.id })).items.map((item) => item.id)
        ).toStrictEqual([second.id]);
        const scoped = yield* notes.notes({ limit: 1, project: project.id });

        expect(
          (yield* notes.notes({
            limit: 1,
            project: project.id,
            before: scoped.next!
          })).items.map((item) => item.id)
        ).toStrictEqual([first.id]);
        expect(
          (yield* notes.notes({ limit: 100, project: null })).items.map((item) => item.id)
        ).toStrictEqual([global.id]);
        assert.strictEqual((yield* notes.notes({ limit: 1 })).items[0]?.id, global.id);
        const absent = 999n as NoteId;

        assert.ok(Option.isNone(yield* notes.findNote(absent)));
        assert.ok((yield* Effect.flip(notes.note(absent))).kind === 'not_found');
        assert.ok(
          (yield* Effect.flip(notes.createNote({ project: project.id, title: ' ' }))).kind ===
            'invalid_input'
        );
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable('messages retain immutable versions and paginate in chronological order', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const layer = Layer.merge(Projects.layer, Notes.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const notes = yield* Notes;
        const project = yield* projects.createProject({ name: 'Messages' });
        const note = yield* notes.createNote({ project: project.id, title: 'Chat' });
        const pageText = '# Lecture notes\n\n- **Key idea**\n- Next steps\n\n> Remember this';
        const input = {
          noteId: note.id,
          text: pageText,
          captureKey: 'page-autosave-identity',
          requestReply: false
        };
        const first = yield* notes.postMessage(input);

        assert.strictEqual((yield* notes.postMessage(input)).id, first.id);
        const second = yield* notes.postMessage({ noteId: note.id, text: 'second' });
        const edited = yield* notes.editMessage({
          messageId: first.id,
          text: 'changed',
          expectedActiveVersionId: first.activeVersionId!
        });

        assert.strictEqual(
          (yield* notes.postMessage(input)).activeVersionId,
          edited.activeVersionId
        );
        assert.ok(
          (yield* Effect.flip(
            notes.editMessage({
              messageId: first.id,
              text: 'stale writer',
              expectedActiveVersionId: first.activeVersionId!
            })
          )).kind === 'invalid_input'
        );
        assert.ok(
          (yield* Effect.flip(notes.postMessage({ ...input, text: 'different payload' }))).kind ===
            'invalid_input'
        );

        expect(edited.versions.map((v) => v.text)).toStrictEqual([pageText, 'changed']);
        assert.strictEqual(edited.versions[1]?.basedOn, first.activeVersionId);
        assert.ok(
          (yield* Effect.flip(
            notes.setActiveVersion({
              messageId: second.id,
              versionId: edited.versions[0]!.id
            })
          )).kind === 'invalid_input'
        );
        const restored = yield* notes.setActiveVersion({
          messageId: first.id,
          versionId: first.activeVersionId!
        });

        assert.strictEqual(restored.activeVersionId, first.activeVersionId);
        expect(
          (yield* notes.thread({ noteId: note.id, limit: 2 })).items.map((m) => m.id)
        ).toStrictEqual([first.id, second.id]);
        const page = yield* notes.thread({ noteId: note.id, limit: 1 });

        assert.strictEqual(page.items[0]?.id, second.id);
        assert.strictEqual(page.next, second.id);
        assert.strictEqual(
          (yield* notes.thread({ noteId: note.id, limit: 1, before: page.next! })).items[0]?.id,
          first.id
        );
        assert.strictEqual(yield* notes.deleteMessage(first.id), true);
        assert.ok((yield* Effect.flip(notes.message(first.id))).kind === 'not_found');
        const { message_versions } = yield* Effect.promise(() => import('@study/db/schema'));
        const { eq } = yield* Effect.promise(() => import('@study/db'));

        assert.strictEqual(
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
    await location.cleanup();
  }
});

testStable(
  'explicit attachment snapshots share sources across collections and survive source deletion',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const layer = Layer.merge(Projects.layer, Notes.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;
          const notes = yield* Notes;
          const project = yield* projects.createProject({ name: 'One' });
          const other = yield* projects.createProject({ name: 'Two' });
          const note = yield* notes.createNote({
            project: project.id,
            title: 'Chat'
          });
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

          const shared = yield* notes.postMessage({
            noteId: note.id,
            text: 'x',
            sourceIds: [foreign.id]
          });

          assert.strictEqual(shared.parts[0]?.sourceId, foreign.id);
          assert.strictEqual((yield* notes.thread({ noteId: note.id, limit: 10 })).items.length, 1);
          const message = yield* notes.postMessage({
            noteId: note.id,
            text: '',
            sourceIds: [b.id, a.id]
          });

          expect(message.parts.map((p) => p.sourceName)).toStrictEqual(['b.txt', 'a.txt']);
          context.db.orm.delete(sources).where(eq(sources.id, b.id)).run();
          const edited = yield* notes.editMessage({
            messageId: message.id,
            text: 'edited'
          });

          expect(edited.parts.map((p) => [p.sourceId, p.sourceName])).toStrictEqual([
            [null, 'b.txt'],
            [a.id, 'a.txt']
          ]);
          assert.ok((yield* notes.deleteNote(note.id)).status === 'pending');
          assert.ok((yield* Effect.flip(notes.message(message.id))).kind === 'not_found');
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

testStable(
  'editing and deleting messages update note ordering with a composite cursor',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const layer = Layer.merge(Projects.layer, Notes.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;
          const notes = yield* Notes;
          const project = yield* projects.createProject({ name: 'Order' });
          const first = yield* notes.createNote({ project: project.id, title: 'First' });
          const second = yield* notes.createNote({
            project: project.id,
            title: 'Second'
          });
          const message = yield* notes.postMessage({ noteId: first.id, text: 'hello' });
          const { notes: noteTable } = yield* Effect.promise(() => import('@study/db/schema'));
          const { eq } = yield* Effect.promise(() => import('@study/db'));

          context.db.orm
            .update(noteTable)
            .set({ updated_at: 1n })
            .where(eq(noteTable.id, first.id))
            .run();
          context.db.orm
            .update(noteTable)
            .set({ updated_at: 2n })
            .where(eq(noteTable.id, second.id))
            .run();
          yield* notes.editMessage({ messageId: message.id, text: 'new' });
          const page = yield* notes.notes({ limit: 1 });

          assert.strictEqual(page.items[0]?.id, first.id);
          assert.strictEqual(
            (yield* notes.notes({ limit: 1, before: page.next! })).items[0]?.id,
            second.id
          );
          context.db.orm
            .update(noteTable)
            .set({ updated_at: 1n })
            .where(eq(noteTable.id, first.id))
            .run();
          yield* notes.deleteMessage(message.id);
          assert.strictEqual((yield* notes.notes({ limit: 1 })).items[0]?.id, first.id);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

testStable(
  'message validation rejects invalid text, incomplete versions, and foreign versions',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const layer = Layer.merge(Projects.layer, Notes.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;
          const notes = yield* Notes;
          const project = yield* projects.createProject({ name: 'Validation' });
          const note = yield* notes.createNote({
            project: project.id,
            title: 'Chat'
          });

          assert.ok(
            (yield* Effect.flip(notes.postMessage({ noteId: note.id, text: '  ' }))).kind ===
              'invalid_input'
          );
          assert.ok(
            (yield* Effect.flip(notes.postMessage({ noteId: note.id, text: '😀'.repeat(100001) })))
              .kind === 'invalid_input'
          );
          const message = yield* notes.postMessage({
            noteId: note.id,
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

          assert.ok(
            (yield* Effect.flip(
              notes.setActiveVersion({ messageId: message.id, versionId: unfinished.id })
            )).kind === 'invalid_input'
          );
          assert.strictEqual(
            (yield* notes.message(message.id)).activeVersionId,
            message.activeVersionId
          );
          assert.ok(
            (yield* Effect.flip(notes.editMessage({ messageId: message.id, text: ' ' }))).kind ===
              'invalid_input'
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

testStable('reply request persists its context and rejects another pending request', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const layer = Layer.merge(Projects.layer, Notes.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const notes = yield* Notes;
        const project = yield* projects.createProject({ name: 'Reply' });
        const note = yield* notes.createNote({ project: project.id, title: 'Chat' });
        const message = yield* notes.postMessage({ noteId: note.id, text: 'hello' });
        const request = yield* notes.requestReply({ noteId: note.id });
        const snapshot = yield* notes.replySnapshot({ requestId: request.requestId });
        const { workflowEvents } = yield* Effect.promise(() => import('@study/db/schema'));
        const { decodeEvent } = yield* Effect.promise(
          () => import('#server/platform/workflows/events')
        );
        const events = context.db.orm
          .select()
          .from(workflowEvents)
          .all()
          .filter((event) => event.type === 'NoteGenerationRequested');

        assert.strictEqual(events.length, 1);
        expect(decodeEvent(events[0]!.payload)).toStrictEqual({
          type: 'NoteGenerationRequested',
          eventId: events[0]!.eventId,
          causationId: null,
          correlationId: request.requestId,
          inputVersion: 1,
          depth: 0,
          ...request,
          operation: 'reply'
        });
        const target = yield* notes.message(request.messageId);

        assert.strictEqual(target.activeVersionId, request.versionId);
        assert.ok(target.versions[0]?.status === 'pending');
        assert.strictEqual(snapshot.messages[0]?.versionId, message.activeVersionId);
        assert.ok(snapshot.messages[0]?.text === 'hello');
        assert.ok(
          (yield* Effect.flip(notes.requestReply({ noteId: note.id }))).kind === 'invalid_input'
        );
        yield* notes.editMessage({ messageId: message.id, text: 'changed' });
        assert.ok(
          (yield* notes.replySnapshot({ requestId: request.requestId })).messages[0]?.text ===
            'hello'
        );
        yield* withTestPublication(context, notes.abandonReply(request).pipe(Effect.asVoid));
        const replacement = yield* notes.requestReply({ noteId: note.id });

        assert.notStrictEqual(replacement.requestId, request.requestId);
        assert.ok(
          (yield* notes.replySnapshot({ requestId: replacement.requestId })).messages[0]?.text ===
            'changed'
        );
        const editedReply = yield* notes.editMessage({
          messageId: replacement.messageId,
          text: 'Keep this complete edit'
        });
        const afterEdit = yield* notes.requestReply({ noteId: note.id });

        assert.strictEqual(
          (yield* notes.message(editedReply.id)).activeVersionId,
          editedReply.activeVersionId
        );
        assert.ok(
          (yield* notes.replySnapshot({ requestId: afterEdit.requestId })).messages.at(-1)?.text ===
            'Keep this complete edit'
        );
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable(
  'reply snapshots retain historical attachments after reopen and reprocessing',
  async () => {
    const location = await createTestDatabase();
    let context = new ServerContext(await location.open());
    const { sources, source_snapshots, content_snapshots, source_processing } =
      await import('@study/db/schema');
    const { eq } = await import('@study/db');
    const layer = () =>
      Layer.merge(Projects.layer, Notes.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const project = yield* (yield* Projects).createProject({ name: 'History' });
          const notes = yield* Notes;
          const note = yield* notes.createNote({
            project: project.id,
            title: 'Chat'
          });
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

          context.db.orm
            .insert(source_snapshots)
            .values({ source_id: source.id, revision: 1n, bytes: Buffer.from('a') })
            .run();
          const document = context.db.orm
            .insert(content_snapshots)
            .values({
              source_id: source.id,
              extractor_version: 1n,
              meta: JSON.stringify(deletionDocument('').meta),
              created_at: 1n
            })
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
          const message = yield* notes.postMessage({
            noteId: note.id,
            text: 'hello',
            sourceIds: [source.id]
          });
          const edited = yield* notes.editMessage({ messageId: message.id, text: 'new' });

          yield* notes.setActiveVersion({
            messageId: message.id,
            versionId: message.activeVersionId!
          });
          const request = yield* notes.requestReply({ noteId: note.id });

          return { request, source, document, message, edited };
        }).pipe(Effect.provide(layer()))
      );

      context.close();
      context = new ServerContext(await location.open());
      const newer = context.db.orm
        .insert(content_snapshots)
        .values({
          source_id: saved.source.id,
          extractor_version: 1n,
          meta: JSON.stringify(deletionDocument('').meta),
          created_at: 2n
        })
        .returning()
        .get();

      context.db.orm
        .update(source_processing)
        .set({ document_id: newer.id })
        .where(eq(source_processing.source_id, saved.source.id))
        .run();
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const snapshot = yield* notes.replySnapshot({
            requestId: saved.request.requestId
          });

          assert.strictEqual(snapshot.messages[0]?.versionId, saved.message.activeVersionId);
          assert.strictEqual(snapshot.messages[0]?.attachments[0]?.snapshotId, saved.document.id);
          assert.ok(snapshot.messages[0]?.attachments[0]?.sourceName === 'a.txt');
          yield* notes.setActiveVersion({
            messageId: saved.message.id,
            versionId: saved.edited.activeVersionId!
          });
          yield* notes.setActiveVersion({
            messageId: saved.message.id,
            versionId: saved.message.activeVersionId!
          });
          expect(yield* notes.replySnapshot({ requestId: saved.request.requestId })).toStrictEqual(
            snapshot
          );
        }).pipe(Effect.provide(layer()))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

testStable('outbox failure rolls back reply request and pending message', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const { sql } = await import('@study/db');
  const { workflowEvents, note_reply_requests } = await import('@study/db/schema');
  const layer = Layer.merge(Projects.layer, Notes.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Rollback' });
        const notes = yield* Notes;
        const note = yield* notes.createNote({ project: project.id, title: 'Chat' });

        yield* notes.postMessage({ noteId: note.id, text: 'hello' });
        context.db.orm.run(
          sql`CREATE TRIGGER fail_reply_event BEFORE INSERT ON workflow_events BEGIN SELECT RAISE(ABORT, 'event failed'); END`
        );
        yield* Effect.flip(notes.requestReply({ noteId: note.id }));
        assert.strictEqual((yield* notes.thread({ noteId: note.id, limit: 10 })).items.length, 1);
        assert.strictEqual(context.db.orm.select().from(note_reply_requests).all().length, 0);
        expect(
          context.db.orm
            .select()
            .from(workflowEvents)
            .all()
            .map((event) => event.type)
        ).toStrictEqual(['NoteQuestionRequested']);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable('reply captures pending attachments and invalidates deleted context', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const { sources, source_snapshots, content_snapshots, source_processing } =
    await import('@study/db/schema');
  const { eq } = await import('@study/db');
  const layer = Layer.merge(Projects.layer, Notes.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Pages' });
        const other = yield* (yield* Projects).createProject({ name: 'Other' });
        const notes = yield* Notes;
        const note = yield* notes.createNote({ project: project.id, title: 'Chat' });
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
        const message = yield* notes.postMessage({
          noteId: note.id,
          text: 'hello',
          sourceIds: [source.id]
        });

        context.db.orm
          .insert(source_snapshots)
          .values({ source_id: source.id, revision: 1n, bytes: Buffer.from('a') })
          .run();
        context.db.orm
          .insert(source_processing)
          .values({
            source_id: source.id,
            revision: 1n,
            request_id: 'one'
          })
          .run();
        const request = yield* notes.requestReply({ noteId: note.id });
        const pending = yield* notes.replySnapshot({ requestId: request.requestId });

        assert.strictEqual(pending.pendingAttachments?.length, 1);
        assert.strictEqual(pending.pendingAttachments?.[0]?.sourceId, source.id);
        const document = context.db.orm
          .insert(content_snapshots)
          .values({
            source_id: source.id,
            extractor_version: 1n,
            meta: JSON.stringify(deletionDocument('').meta),
            created_at: 1n
          })
          .returning()
          .get();

        context.db.orm
          .update(source_processing)
          .set({ document_id: document.id, published_request_id: 'one' })
          .where(eq(source_processing.source_id, source.id))
          .run();
        // Collection reassignment is permitted; keep the captured input unchanged for readiness.
        context.db.orm
          .update(sources)
          .set({ project_id: other.id })
          .where(eq(sources.id, source.id))
          .run();
        context.db.orm
          .update(sources)
          .set({ project_id: project.id })
          .where(eq(sources.id, source.id))
          .run();
        assert.strictEqual(
          (yield* notes.replyReadiness({ requestId: request.requestId })).length,
          0
        );
        context.db.orm
          .update(source_processing)
          .set({ request_id: 'replacement', revision: 2n })
          .where(eq(source_processing.source_id, source.id))
          .run();
        assert.ok(
          (yield* Effect.flip(notes.replySnapshot({ requestId: request.requestId }))).kind ===
            'invalid_input'
        );
        yield* notes.deleteMessage(message.id);
        assert.ok(
          (yield* Effect.flip(notes.replySnapshot({ requestId: request.requestId }))).kind ===
            'not_found'
        );
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable('reply history includes every active note and rejects excess total text', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const layer = Layer.merge(Projects.layer, Notes.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Bounded' });
        const notes = yield* Notes;
        const note = yield* notes.createNote({
          project: project.id,
          title: 'History'
        });

        for (let i = 0; i < 60; i++)
          yield* notes.postMessage({ noteId: note.id, text: `message ${i}` });

        const request = yield* notes.requestReply({ noteId: note.id });
        const history = yield* notes.replySnapshot({ requestId: request.requestId });

        assert.strictEqual(history.messages.length, 60);
        assert.ok(history.messages[0]?.text === 'message 0');
        assert.ok(history.messages.at(-1)?.text === 'message 59');
        const largeNote = yield* notes.createNote({
          project: project.id,
          title: 'Large'
        });

        for (let i = 0; i < 3; i++)
          yield* notes.postMessage({
            noteId: largeNote.id,
            text: String(i).repeat(80000)
          });

        assert.strictEqual(
          (yield* Effect.flip(notes.requestReply({ noteId: largeNote.id }))).kind,
          'not_enough'
        );
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable('untitled notes capture title requests and reject stale context', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const layer = Layer.merge(Projects.layer, Notes.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const notes = yield* Notes;
        const { Settings } = yield* Effect.promise(() => import('#server/features/settings/index'));
        const project = yield* projects.createProject({ name: 'Title' });
        const note = yield* notes
          .createUntitledNote({ project: project.id })
          .pipe(
            Effect.provide(
              Settings.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })))
            )
          );

        assert.ok(note.titleSource === 'provisional');
        assert.ok(note.title === 'New note');
        const settingsLayer = Settings.layer.pipe(
          Layer.provideMerge(Layer.succeed(Database, { store: context }))
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
        const italian = yield* notes
          .createUntitledNote({ project: project.id })
          .pipe(Effect.provide(settingsLayer));

        assert.ok(italian.title === 'Nuova nota');
        const message = yield* notes.postMessage({
          noteId: note.id,
          text: 'Study cells'
        });
        const request = yield* notes.requestTitle({ noteId: note.id });
        const snapshot = yield* notes.titleSnapshot({ requestId: request.requestId });

        assert.strictEqual(snapshot.messages[0]?.versionId, message.activeVersionId);
        assert.ok(snapshot.messages[0]?.text === 'Study cells');
        yield* notes.editMessage({ messageId: message.id, text: 'Study plants' });
        assert.ok(
          (yield* Effect.flip(notes.titleSnapshot({ requestId: request.requestId }))).kind ===
            'invalid_input'
        );
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable('title context retains every active note within its text budget', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const { Settings } = await import('#server/features/settings/index');
  const layer = Layer.mergeAll(Projects.layer, Notes.layer, Settings.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Bounded title' });
        const notes = yield* Notes;
        const note = yield* notes.createUntitledNote({ project: project.id });

        for (let i = 0; i < 51; i++)
          yield* notes.postMessage({ noteId: note.id, text: `message ${i}` });

        const request = yield* notes.requestTitle({ noteId: note.id });
        const snapshot = yield* notes.titleSnapshot({ requestId: request.requestId });

        assert.strictEqual(snapshot.messages.length, 51);
        assert.ok(snapshot.messages[0]?.text === 'message 0');
        assert.ok(snapshot.messages.at(-1)?.text === 'message 50');
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable(
  'titles respect the aggregate text budget and do not require ready attachment content_snapshots',
  async () => {
    const { Settings } = await import('#server/features/settings/index');
    const { Sources } = await import('#server/features/sources/index');
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const services = Layer.mergeAll(
      Projects.layer,
      Notes.layer,
      Settings.layer,
      Sources.layer
    ).pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const project = yield* (yield* Projects).createProject({ name: 'Title limits' });
          const notes = yield* Notes;
          const sources = yield* Sources;
          const source = yield* sources.createSource({
            name: 'notes.txt',
            bytes: new TextEncoder().encode('not indexed'),
            projectId: project.id
          });

          assert.ok((yield* sources.sourceProcessing(source.id)).documentId === null);
          const note = yield* notes.createUntitledNote({ project: project.id });

          yield* notes.postMessage({
            noteId: note.id,
            text: 'Study this attachment',
            sourceIds: [source.id]
          });
          const pending = yield* notes.requestTitle({ noteId: note.id });

          assert.strictEqual(
            (yield* notes.titleSnapshot({ requestId: pending.requestId })).messages.length,
            1
          );
          const large = yield* notes.createUntitledNote({ project: project.id });

          for (let i = 0; i < 3; i++)
            yield* notes.postMessage({
              noteId: large.id,
              text: String(i).repeat(80000)
            });

          assert.strictEqual(
            (yield* Effect.flip(notes.requestTitle({ noteId: large.id }))).kind,
            'not_enough'
          );
        }).pipe(Effect.provide(services))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

testStable('attachment threads are isolated, owned and paginated', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const { sources, source_snapshots, content_snapshots, source_processing } =
    await import('@study/db/schema');
  const layer = Layer.merge(Projects.layer, Notes.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Threads' });
        const notes = yield* Notes;
        const note = yield* notes.createNote({ project: project.id, title: 'Chat' });
        const other = yield* notes.createNote({ project: project.id, title: 'Other' });
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

        context.db.orm
          .insert(source_snapshots)
          .values({ source_id: source.id, revision: 1n, bytes: Buffer.from('a') })
          .run();
        const document = context.db.orm
          .insert(content_snapshots)
          .values({
            source_id: source.id,
            extractor_version: 1n,
            meta: JSON.stringify(deletionDocument('').meta),
            created_at: 1n
          })
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
        const root = yield* notes.postMessage({
          noteId: note.id,
          text: 'root',
          sourceIds: [source.id]
        });
        const part = root.parts[0]!.id;

        assert.ok(
          (yield* Effect.flip(
            notes.postMessage({ noteId: other.id, text: 'bad', threadRoot: part })
          )).kind === 'invalid_input'
        );
        const one = yield* notes.postMessage({
          noteId: note.id,
          text: 'one',
          threadRoot: part
        });
        const two = yield* notes.postMessage({
          noteId: note.id,
          text: 'two',
          threadRoot: part
        });

        expect(
          (yield* notes.thread({ noteId: note.id, limit: 10 })).items.map((m) => m.id)
        ).toStrictEqual([root.id]);
        const page = yield* notes.thread({
          noteId: note.id,
          threadRoot: part,
          limit: 1
        });

        assert.strictEqual(page.items[0]?.id, two.id);
        assert.strictEqual(
          (yield* notes.thread({
            noteId: note.id,
            threadRoot: part,
            limit: 1,
            before: page.next!
          })).items[0]?.id,
          one.id
        );
        const request = yield* notes.requestReply({
          noteId: note.id,
          threadRoot: part
        });
        const reply = yield* notes.message(request.messageId);

        assert.strictEqual(reply.threadRoot, part);
        assert.strictEqual(reply.replyTo, two.id);
        const snapshot = yield* notes.replySnapshot({ requestId: request.requestId });

        expect(snapshot.messages.map((m) => m.text)).toStrictEqual(['root', 'one', 'two']);
        assert.strictEqual(snapshot.messages[0]?.attachments[0]?.partId, part);
        const { message_versions } = yield* Effect.promise(() => import('@study/db/schema'));
        const { eq } = yield* Effect.promise(() => import('@study/db'));

        context.db.orm
          .update(message_versions)
          .set({ status: 'complete', text: 'answer' })
          .where(eq(message_versions.id, request.versionId))
          .run();
        const reanswer = yield* notes.reanswer({ messageId: request.messageId });
        const reanswerSnapshot = yield* notes.replySnapshot({
          requestId: reanswer.requestId
        });

        expect(reanswerSnapshot.messages.map((m) => m.text)).toStrictEqual(['root', 'one', 'two']);
        assert.strictEqual((yield* notes.message(reanswer.messageId)).threadRoot, part);
        context.db.orm
          .update(message_versions)
          .set({ status: 'complete', text: 'another answer' })
          .where(eq(message_versions.id, reanswer.versionId))
          .run();
        const rewrite = yield* notes.rewriteMessage({
          messageId: reanswer.messageId,
          origin: 'improve'
        });
        const rewriteSnapshot = yield* notes.replySnapshot({
          requestId: rewrite.requestId
        });

        expect(rewriteSnapshot.messages.map((m) => m.text)).toStrictEqual([
          'root',
          'one',
          'two',
          'another answer'
        ]);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable('posting a message can request a reply explicitly or by assistant mention', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const layer = Layer.merge(Projects.layer, Notes.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Mention' });
        const notes = yield* Notes;
        const note = yield* notes.createNote({ project: project.id, title: 'Chat' });
        const posted = yield* notes.postMessage({
          noteId: note.id,
          text: 'Please help',
          requestReply: true
        });
        const items = (yield* notes.thread({ noteId: note.id, limit: 10 })).items;

        assert.strictEqual(items.length, 2);
        assert.strictEqual(items[1]?.replyTo, posted.id);
        const second = yield* notes.createNote({
          project: project.id,
          title: 'Mention'
        });
        const mention = yield* notes.postMessage({
          noteId: second.id,
          text: 'Hello @study!'
        });

        assert.strictEqual(
          (yield* notes.thread({ noteId: second.id, limit: 10 })).items[1]?.replyTo,
          mention.id
        );

        for (const [text, replies] of [
          ['@STUDY', true],
          ['Hello @study, help?', true],
          ['@study123', false],
          ['@study_notes', false],
          ['@studying', false],
          ['@studyé', false],
          ['@study中文', false],
          ['@study\u0301', false],
          ['mail@study', false]
        ] as const) {
          const target = yield* notes.createNote({ title: 'Mention boundary' });

          yield* notes.postMessage({ noteId: target.id, text });
          const thread = yield* notes.thread({ noteId: target.id, limit: 10 });

          assert.strictEqual(thread.items.length, replies ? 2 : 1, text);
        }
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable(
  'note source links survive raw message deletion while authored documents keep independent project lifetime',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const layer = Layer.mergeAll(Projects.layer, Notes.layer, Sources.layer, Pages.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects,
            notes = yield* Notes,
            sources = yield* Sources,
            documents = yield* Pages;
          const project = yield* projects.createProject({ name: 'Independent lifetime' });
          const note = yield* notes.createNote({
            title: 'Raw note',
            project: project.id
          });
          const source = yield* sources.createSource({
            name: 'note.txt',
            bytes: new TextEncoder().encode('Original bytes'),
            projectId: project.id
          });
          const message = yield* notes.postMessage({
            noteId: note.id,
            text: 'Raw note',
            sourceIds: [source.id],
            requestReply: false
          });

          assert.strictEqual(
            (yield* sources.noteSources({ noteId: note.id, limit: 100 }))[0].id,
            source.id
          );
          const authored = yield* documents.create({
            createKey: 'independent-note-document',
            title: 'Authored output',
            document: deletionDocument('Authored body'),
            inputs: [],
            citations: [],
            noteId: note.id
          });

          expect(authored.projectIds).toStrictEqual([project.id]);
          yield* notes.deleteMessage(message.id);
          assert.strictEqual(
            (yield* sources.noteSources({ noteId: note.id, limit: 100 }))[0].id,
            source.id
          );
          yield* notes.deleteNote(note.id);
          assert.ok(
            (yield* documents.page({ id: authored.id })).version!.document.blocks[0].text ===
              'Authored body'
          );
          expect((yield* documents.page({ id: authored.id })).projectIds).toStrictEqual([
            project.id
          ]);
          assert.strictEqual(
            (yield* documents.pages({ projectId: project.id, limit: 100, archived: false }))
              .items[0].id,
            authored.id
          );
          assert.ok((yield* sources.source(source.id)).name === 'note.txt');
          assert.strictEqual(context.db.orm.get(sql`SELECT count(*) n FROM note_sources`)?.n, 0n);
          assert.strictEqual(context.db.orm.get(sql`SELECT count(*) n FROM messages`)?.n, 0n);
          expect(context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

testStable(
  'deletes an exact note version, preserves other items, and protects the final version',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const layer = Notes.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const note = yield* notes.createNote({ title: 'Version deletion' });
          const original = yield* notes.postMessage({
            noteId: note.id,
            text: 'Original',
            requestReply: false
          });
          const other = yield* notes.postMessage({
            noteId: note.id,
            text: 'Other item',
            requestReply: false
          });
          const edited = yield* notes.editMessage({
            messageId: original.id,
            text: 'Second'
          });
          const latest = yield* notes.editMessage({
            messageId: original.id,
            text: 'Third'
          });

          expect(
            (yield* Effect.flip(
              notes.deleteMessageVersion({
                messageId: other.id,
                versionId: edited.activeVersionId!
              })
            )).kind
          ).toBe('invalid_input');
          const remaining = yield* notes.deleteMessageVersion({
            messageId: original.id,
            versionId: edited.activeVersionId!
          });

          expect(remaining.versions.map((version) => version.text)).toEqual(['Original', 'Third']);
          expect(remaining.activeVersionId).toBe(latest.activeVersionId);
          expect(remaining.versions[1]?.basedOn).toBeNull();
          const fallback = yield* notes.deleteMessageVersion({
            messageId: original.id,
            versionId: latest.activeVersionId!
          });

          expect(fallback.activeVersionId).toBe(original.activeVersionId);
          expect(
            (yield* Effect.flip(
              notes.deleteMessageVersion({
                messageId: original.id,
                versionId: original.activeVersionId!
              })
            )).kind
          ).toBe('invalid_input');
          expect((yield* notes.message(other.id)).versions[0]?.text).toBe('Other item');
          expect(yield* notes.deleteMessage(original.id)).toBe(true);
          expect(
            (yield* notes.thread({ noteId: note.id, limit: 100 })).items.map(
              (message) => message.id
            )
          ).toEqual([other.id]);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
