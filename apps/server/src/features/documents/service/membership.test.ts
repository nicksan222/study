/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Project and session memberships never own an authored document's lifetime.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies native authored project links are idempotent and project/session deletion     │
 * │   preserves independent versions.                                                        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { DocumentsRpc } from '@study/contracts/documents/rpc';
import { projectIdSchema } from '@study/contracts/ids';
import { sql } from '@study/db';
import { testStable } from '@study/testing/node';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Conversations } from '#server/features/conversations/index';
import { DocumentsRpcLive } from '#server/features/documents/rpc/index';
import { Projects } from '#server/features/projects/index';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';
import { cleanup } from '#testing/session-deletion';

testStable(
  'native authored project links are idempotent and project/session deletion preserves independent versions',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(DocumentsRpc);
            const projects = yield* Projects;
            const chats = yield* Conversations;
            const a = yield* projects.createProject({ name: 'A' });
            const b = yield* projects.createProject({ name: 'B' });
            const session = yield* chats.createUntitledSession({});
            const document = yield* rpc['documents.create']({
              createKey: randomUUID(),
              title: 'Independent',
              document: deletionDocument('Retained body'),
              inputs: [],
              citations: [],
              projectId: a.id,
              sessionId: session.id
            });

            assert.ok(document.version);
            const link = { documentId: document.id, projectId: b.id };

            yield* rpc['documents.attachProject'](link);
            yield* rpc['documents.attachProject'](link);
            assert.deepEqual((yield* rpc['documents.document']({ id: document.id })).projectIds, [
              a.id,
              b.id
            ]);
            const missing = {
              ...link,
              projectId: Schema.decodeUnknownSync(projectIdSchema)(b.id + 999n)
            };

            assert.equal(
              (yield* Effect.flip(rpc['documents.attachProject'](missing))).kind,
              'not_found'
            );
            assert.equal(
              (yield* Effect.flip(rpc['documents.detachProject'](missing))).kind,
              'not_found'
            );
            yield* rpc['documents.detachProject']({ documentId: document.id, projectId: a.id });
            yield* rpc['documents.detachProject']({ documentId: document.id, projectId: a.id });
            yield* projects.deleteProject({ id: a.id });
            yield* projects.deleteProject({ id: b.id });
            assert.deepEqual(
              (yield* rpc['documents.document']({ id: document.id })).projectIds,
              []
            );
            assert.deepEqual(
              yield* rpc['documents.version']({ id: document.version.id }),
              document.version
            );
            yield* chats.deleteSession(session.id);

            return { sessionId: session.id, document, version: document.version };
          })
        ).pipe(Effect.provide(DocumentsRpcLive.pipe(Layer.provideMerge(f.domain()))))
      );

      await cleanup(f, saved.sessionId);
      f.reopen();
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(DocumentsRpc);

            assert.deepEqual(
              yield* rpc['documents.version']({ id: saved.version.id }),
              saved.version
            );
            const all = yield* rpc['documents.documents']({ limit: 10, archived: false });

            assert.equal(all.items[0]?.id, saved.document.id);
            assert.equal(
              f.context.db.orm.get(sql`SELECT count(*) n FROM session_documents`)?.n,
              0n
            );
            assert.equal(
              f.context.db.orm.get(sql`SELECT count(*) n FROM project_documents`)?.n,
              0n
            );
            assert.equal(f.context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 0n);
          })
        ).pipe(Effect.provide(DocumentsRpcLive.pipe(Layer.provideMerge(f.domain()))))
      );
      assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      await f.close();
    }
  }
);
