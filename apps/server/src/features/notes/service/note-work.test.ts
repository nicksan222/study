/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises note work discovery through real SQLite and native RPC.                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verify note isolation, bounded pagination and cancellation receipts.                   │
 * │ - Exclude retired note work without substituting workflow services.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Real feature services own state; fixtures provide isolated SQLite and native RPC.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { NotesRpc } from '@study/contracts/notes/rpc';
import { eq } from '@study/db';
import { workflow_executions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { assert, expect } from 'vite-plus/test';

import { NotesRpcLive } from '#server/features/notes/rpc/index';
import { Notes } from '#server/features/notes/service/index';
import { Pages } from '#server/features/pages/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

testStable(
  'note work RPC scopes active executions, paginates, and preserves canonical cancellation state',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const layer = Layer.mergeAll(Notes.layer, Pages.layer, Sources.layer, Settings.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const chats = yield* Notes;
            const sources = yield* Sources;
            const note = yield* chats.createNote({ title: 'Study' });
            const other = yield* chats.createNote({ title: 'Other' });
            const source = yield* sources.createSource({
              name: 'lecture.txt',
              bytes: new TextEncoder().encode('Lecture notes'),
              projectId: null
            });

            yield* chats.postMessage({
              noteId: note.id,
              text: 'Question',
              requestReply: false
            });
            yield* chats.postMessage({
              noteId: other.id,
              text: 'Other question',
              requestReply: false
            });
            const processing = yield* sources.sourceProcessing(source.id);
            const capture = yield* chats.captureNoteContext({
              noteId: note.id,
              intentKey: 'work-test',
              instruction: 'Organize notes',
              preferences: {}
            });
            const transform = yield* chats.requestPageTransform({
              contextRequestId: capture.requestId,
              title: 'Study guide',
              operations: ['clarity']
            });

            yield* chats.postMessage({
              noteId: note.id,
              text: '',
              sourceIds: [source.id],
              requestReply: false
            });
            const reply = yield* chats.requestReply({ noteId: note.id });
            const foreignReply = yield* chats.requestReply({ noteId: other.id });

            for (const [id, correlationId, createdAt] of [
              ['reply-work', reply.requestId, 20n],
              ['z-attachment-work', processing.requestId, 20n],
              ['transform-work', transform.id, 30n],
              ['foreign-work', foreignReply.requestId, 40n]
            ] as const)
              context.db.orm
                .insert(workflow_executions)
                .values({
                  execution_id: id,
                  workflow_tag: 'test',
                  version: 1,
                  payload: JSON.stringify({ event: { correlationId } }),
                  status: 'running',
                  created_at: createdAt,
                  updated_at: createdAt
                })
                .run();

            const rpc = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
            const first = yield* rpc('notes.noteWork', {
              noteId: note.id,
              limit: 2
            });

            expect(first.items.map((item) => item.kind)).toStrictEqual(['transform', 'attachment']);
            expect(first.items.map((item) => item.title)).toStrictEqual([
              'Study guide',
              'lecture.txt'
            ]);
            assert.ok(first.items.every((item) => item.execution.canCancel));
            assert.ok(first.next);
            const second = yield* rpc('notes.noteWork', {
              noteId: note.id,
              limit: 2,
              before: first.next
            });

            expect(second.items.map((item) => item.execution.id)).toStrictEqual(['reply-work']);
            assert.strictEqual(second.next, null);
            context.db.orm
              .update(workflow_executions)
              .set({ result: '"__interrupt_safe__"' })
              .where(eq(workflow_executions.execution_id, 'reply-work'))
              .run();
            const cancelling = yield* chats.noteWork({ noteId: note.id, limit: 100 });

            assert.strictEqual(
              cancelling.items.find((item) => item.kind === 'reply')?.execution.status,
              'cancelling'
            );
            assert.strictEqual(
              cancelling.items.find((item) => item.kind === 'reply')?.execution.canCancel,
              false
            );
            context.db.orm
              .update(workflow_executions)
              .set({ status: 'cancelled', result: null })
              .where(eq(workflow_executions.execution_id, 'reply-work'))
              .run();
            assert.strictEqual(
              (yield* chats.noteWork({ noteId: note.id, limit: 100 })).items.length,
              2
            );
            expect(
              (yield* chats.noteWork({ noteId: other.id, limit: 100 })).items.map(
                (item) => item.execution.id
              )
            ).toStrictEqual(['foreign-work']);
            yield* chats.deleteNote(note.id);
            const error = yield* Effect.flip(chats.noteWork({ noteId: note.id, limit: 100 }));

            assert.strictEqual(error.kind, 'not_found');
          })
        ).pipe(Effect.provide(NotesRpcLive), Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
