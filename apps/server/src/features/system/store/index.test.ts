import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect } from 'effect';

import { ServerContext } from '#server/platform/database/context';

import { SystemStore } from './index.ts';

test('search reads bounded project and source projections from SQLite', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    context.db.orm.run(
      sql`INSERT INTO projects (id,name,created_at,updated_at) VALUES (1,'Physics',1,2)`
    );
    context.db.orm.run(
      sql`INSERT INTO sources (id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES (1,1,'attachment','text','text/plain','Physics notes',1,zeroblob(32),3)`
    );
    const store = SystemStore.make(context);
    const result = await Effect.runPromise(store.searches({ query: 'physics', limit: 10 }));

    assert.deepEqual(result.map((hit) => hit.kind).sort(), ['project', 'source']);
    assert.deepEqual(
      (
        await Effect.runPromise(store.searches({ query: 'physics', limit: 10, kinds: ['source'] }))
      ).map((hit) => hit.kind),
      ['source']
    );
    assert.equal((await Effect.runPromise(store.searches({ query: '!!!', limit: 10 }))).length, 0);
    assert.equal(
      (await Effect.runPromise(store.searches({ query: 'physics', limit: 1 }))).length,
      1
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('passage search retains anchors and ignores superseded documents', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    context.db.orm.run(
      sql`INSERT INTO projects (id,name,created_at,updated_at) VALUES (1,'Science',1,1)`
    );
    context.db.orm.run(
      sql`INSERT INTO sources (id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES (1,1,'attachment','text','text/plain','Notes',1,zeroblob(32),1)`
    );
    context.db.orm.run(
      sql`INSERT INTO documents (id,source_id,extractor_version,meta,created_at) VALUES (1,1,1,'{}',1),(2,1,1,'{}',2),(3,1,1,'{}',3)`
    );
    context.db.orm.run(
      sql`INSERT INTO chunks (id,document_id,ordinal,first_block,last_block,anchor,text,content_hash) VALUES (1,1,0,0,0,'{"type":"page","page":1}','obsolete fossils',zeroblob(32)),(2,2,0,0,0,'{"type":"page","page":2}','current molecules',zeroblob(32)),(3,3,0,0,0,'{"type":"page","page":3}','unpublished atoms',zeroblob(32))`
    );
    context.db.orm.run(
      sql`INSERT INTO source_processing (source_id,revision,request_id,document_id,published_request_id) VALUES (1,1,'request',2,'request')`
    );
    const store = SystemStore.make(context);

    assert.equal(
      (await Effect.runPromise(store.searches({ query: 'obsolete', limit: 10 }))).length,
      0
    );
    assert.equal(
      (await Effect.runPromise(store.searches({ query: 'unpublished', limit: 10 }))).length,
      0
    );
    const result = await Effect.runPromise(store.searches({ query: 'molecules', limit: 10 }));

    assert.equal(result.length, 1);
    assert.deepEqual(result[0]?.target, {
      type: 'source',
      sourceId: 1n,
      anchor: { type: 'page', page: 2 }
    });
  } finally {
    context.close();
    location.cleanup();
  }
});

test('search indexes only current published quiz material and prompts', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    const run = (query: ReturnType<typeof sql>) => context.db.orm.run(query);

    run(
      sql`INSERT INTO projects(id,name,created_at,updated_at) VALUES (1,'Science',1,1),(2,'Other',1,1)`
    );
    run(
      sql`INSERT INTO materials(id,project_id,kind,title,created_at,updated_at) VALUES (1,1,'quiz','Café gravity',1,1)`
    );
    run(
      sql`INSERT INTO material_versions(id,material_id,project_id,kind,number,status,created_at) VALUES (1,1,1,'quiz',1,'draft',1)`
    );
    run(sql`INSERT INTO material_quiz_versions(version_id) VALUES (1)`);
    run(
      sql`INSERT INTO material_quiz_questions(id,version_id,position,kind,prompt,explanation) VALUES (1,1,0,'open','Orbital motion','Secret explanation')`
    );
    run(
      sql`INSERT INTO material_quiz_open_answers(question_id,reference_answer) VALUES (1,'Secret reference')`
    );
    const store = SystemStore.make(context);
    const find = (query: string, project?: bigint) =>
      Effect.runPromise(store.searches({ query, limit: 10, project: project as never }));

    assert.equal((await find('orbital')).length, 0);
    run(sql`UPDATE material_versions SET status='published',published_at=2 WHERE id=1`);
    assert.deepEqual(
      (await find('cafe')).map((hit) =>
        hit.target.type === 'material' ? hit.target.materialKind : hit.kind
      ),
      ['quiz']
    );
    assert.deepEqual(
      (await find('orbital')).map((hit) => hit.kind),
      ['question']
    );
    assert.equal((await find('secret')).length, 0);
    assert.equal((await find('orbital', 2n)).length, 0);
    run(sql`UPDATE materials SET archived_at=3 WHERE id=1`);
    assert.equal((await find('orbital')).length, 0);
    run(sql`UPDATE materials SET archived_at=NULL WHERE id=1`);
    assert.equal((await find('orbital')).length, 1);
    run(sql`UPDATE materials SET title='Renamed nebula',updated_at=4 WHERE id=1`);
    assert.equal((await find('cafe')).length, 0);
    assert.equal((await find('nebula')).length, 1);
    run(
      sql`INSERT INTO material_versions(id,material_id,project_id,kind,number,status,created_at) VALUES (2,1,1,'quiz',2,'draft',4)`
    );
    run(sql`INSERT INTO material_quiz_versions(version_id) VALUES (2)`);
    run(
      sql`INSERT INTO material_quiz_questions(id,version_id,position,kind,prompt,explanation) VALUES (2,2,0,'open','Quantum "lumière"','Hidden')`
    );
    run(
      sql`INSERT INTO material_quiz_open_answers(question_id,reference_answer) VALUES (2,'Private')`
    );
    assert.equal((await find('quantum')).length, 0);
    run(sql`UPDATE material_versions SET status='published',published_at=5 WHERE id=2`);
    assert.equal((await find('orbital')).length, 0);
    const hits = await find('quantum "lumiere"');

    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0]?.target, {
      type: 'question',
      projectId: 1n,
      materialId: 1n,
      versionId: 2n,
      questionId: 2n
    });
    assert.throws(() => run(sql`DELETE FROM materials WHERE id=1`));
    assert.equal((await find('quantum')).length, 1);
    run(sql`DELETE FROM projects WHERE id=1`);
    assert.equal((await find('quantum')).length, 0);
    assert.equal(
      context.db.orm.all(sql`SELECT rowid FROM catalog_fts WHERE kind IN ('material','question')`)
        .length,
      0
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
