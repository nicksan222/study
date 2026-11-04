/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks the live system RPC surface against a running in-process server and its     │
 * │ published search results.                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises native System RPC returns published quiz search identities.                  │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyRpc } from '@study/contracts/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

testStable('native System RPC returns published quiz search identities', async () => {
  const location = createTestDatabase();
  const app = await App.open({ path: location.path });
  const server = await serve(app);

  try {
    const db = app.store.db.orm;

    db.run(
      sql`INSERT INTO projects(id,name,created_at,updated_at) VALUES (1,'Science',1,1),(2,'Other',1,1)`
    );
    db.run(
      sql`INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES (1,'quiz','Astronomy',1,1)`
    );
    db.run(
      sql`INSERT INTO material_versions(id,material_id,kind,number,status,created_at) VALUES (1,1,'quiz',1,'draft',1)`
    );
    db.run(sql`INSERT INTO material_quiz_versions(version_id) VALUES (1)`);
    db.run(
      sql`INSERT INTO material_quiz_questions(id,version_id,position,kind,prompt,explanation) VALUES (1,1,0,'open','Solar orbit','Hidden')`
    );
    db.run(
      sql`INSERT INTO material_quiz_open_answers(question_id,reference_answer) VALUES (1,'Private')`
    );
    db.run(sql`UPDATE material_versions SET status='published',published_at=2 WHERE id=1`);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
          const result = yield* client['system.search']({ query: 'solar', limit: 1 });

          expect(result.hits[0]?.target).toStrictEqual({
            type: 'question',
            materialId: 1n,
            versionId: 1n,
            questionId: 1n
          });
          const filtered = yield* client['system.search']({
            query: 'solar',
            limit: 10,
            kinds: ['session', 'message']
          });

          expect(filtered.hits).toStrictEqual([]);
          const material = yield* client['system.search']({
            query: 'astronomy',
            limit: 10,
            kinds: ['material']
          });

          assert.ok(
            material.hits[0]?.target.type === 'material' &&
              material.hits[0].target.materialKind === 'quiz'
          );
          const other = yield* client['system.search']({
            query: 'solar',
            limit: 10,
            project: 2n as never
          });

          assert.strictEqual(other.hits.length, 0);
        })
      )
    );
  } finally {
    await server.close();
    await app.close();
    location.cleanup();
  }
});
