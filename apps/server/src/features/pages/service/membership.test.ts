/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Project and note memberships never own an authored document's lifetime.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies native authored project links are idempotent and project/note deletion        │
 * │   preserves independent versions.                                                        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { projectIdSchema } from '@study/contracts/ids';
import { PagesRpc } from '@study/contracts/pages/rpc';
import { sql } from '@study/db';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Notes } from '#server/features/notes/index';
import { PagesRpcLive } from '#server/features/pages/rpc/index';
import { Projects } from '#server/features/projects/index';
import { deletionDocument } from '#testing/material-deletion';
import { cleanup } from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';

testStable(
  'native authored project links are idempotent and project/note deletion preserves independent versions',
  async () => {
    const f = await pageTransformFixture();

    try {
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(PagesRpc);
            const projects = yield* Projects;
            const chats = yield* Notes;
            const a = yield* projects.createProject({ name: 'A' });
            const b = yield* projects.createProject({ name: 'B' });
            const note = yield* chats.createUntitledNote({});
            const document = yield* rpc['pages.create']({
              createKey: crypto.randomUUID(),
              title: 'Independent',
              document: deletionDocument('Retained body'),
              inputs: [],
              citations: [],
              projectId: a.id,
              noteId: note.id
            });

            assert.ok(document.version);
            const link = { pageId: document.id, projectId: b.id };

            yield* rpc['pages.attachProject'](link);
            yield* rpc['pages.attachProject'](link);
            expect((yield* rpc['pages.page']({ id: document.id })).projectIds).toStrictEqual([
              a.id,
              b.id
            ]);
            const missing = {
              ...link,
              projectId: Schema.decodeUnknownSync(projectIdSchema)(b.id + 999n)
            };

            assert.ok(
              (yield* Effect.flip(rpc['pages.attachProject'](missing))).kind === 'not_found'
            );
            assert.ok(
              (yield* Effect.flip(rpc['pages.detachProject'](missing))).kind === 'not_found'
            );
            yield* rpc['pages.detachProject']({ pageId: document.id, projectId: a.id });
            yield* rpc['pages.detachProject']({ pageId: document.id, projectId: a.id });
            yield* projects.deleteProject({ id: a.id });
            yield* projects.deleteProject({ id: b.id });
            expect((yield* rpc['pages.page']({ id: document.id })).projectIds).toStrictEqual([]);
            expect(yield* rpc['pages.version']({ id: document.version.id })).toStrictEqual(
              document.version
            );
            yield* chats.deleteNote(note.id);

            return { noteId: note.id, document, version: document.version };
          })
        ).pipe(Effect.provide(PagesRpcLive.pipe(Layer.provideMerge(f.domain()))))
      );

      await cleanup(f, saved.noteId);
      await f.reopen();
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(PagesRpc);

            expect(yield* rpc['pages.version']({ id: saved.version.id })).toStrictEqual(
              saved.version
            );
            const all = yield* rpc['pages.pages']({ limit: 10, archived: false });

            assert.strictEqual(all.items[0]?.id, saved.document.id);
            assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM note_pages`)?.n, 0n);
            assert.strictEqual(
              f.context.db.orm.get(sql`SELECT count(*) n FROM project_pages`)?.n,
              0n
            );
            assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 0n);
          })
        ).pipe(Effect.provide(PagesRpcLive.pipe(Layer.provideMerge(f.domain()))))
      );
      expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);
