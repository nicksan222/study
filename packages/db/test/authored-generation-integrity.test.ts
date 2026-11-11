import { testStable } from '@study/testing/vitest';
import { sql } from 'drizzle-orm';
import { assert, expect } from 'vite-plus/test';

import { createTestDatabase } from '../src/testing.ts';

async function fixture(patch: Record<string, unknown> = {}, generationNote: number | null = null) {
  const location = await createTestDatabase();
  const db = await location.open();

  db.exec(`INSERT INTO notes(id,title,title_source,created_at,updated_at) VALUES(1,'Proposal','user',1,1),(2,'Other','user',1,1);
 INSERT INTO pages(id,title,created_at,updated_at) VALUES(1,'Target',1,1),(3,'Other',1,1);
 INSERT INTO content_snapshots(id,extractor_version,meta,created_at) VALUES(1,1,'{}',1),(2,1,'{}',1),(3,1,'{}',1),(4,1,'{}',1);
 INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor)
 SELECT id,0,'paragraph','block-'||id,'{"type":"paragraph","inlines":[{"type":"text","text":"Evidence","marks":[]}]}','Evidence','{"type":"authored"}' FROM content_snapshots;
 INSERT INTO page_versions(id,page_id,number,content_snapshot_id,created_at) VALUES(1,1,1,1,1),(3,1,2,2,1),(5,3,1,3,1);
 UPDATE page_versions SET status='published',published_at=2;
`);
  const capture = {
    requestId: 'capture',
    noteId: '1',
    inputs: [
      { input: { kind: 'page', versionId: '1' }, snapshotId: '1', scope: { kind: 'document' } }
    ],
    messages: [],
    ...patch
  };

  db.orm.run(
    sql`INSERT INTO note_run_contexts(request_id,note_id,intent_key,intent,snapshot) VALUES('capture',1,'proposal','{}',${JSON.stringify(capture)})`
  );
  db.exec(` INSERT INTO note_context_pages(request_id,version_id) VALUES('capture',1);
 INSERT INTO page_transform_requests(id,context_request_id,note_id,request,intent_hash,instruction,event_id,created_at)
 VALUES('document/capture','capture',1,'{"title":"Proposal","contextRequestId":"capture","operations":["clarity"],"editTargetVersionId":"1"}','${'a'.repeat(64)}','Clarify','event',1);
 INSERT INTO page_versions(id,page_id,number,content_snapshot_id,operation,creator,instruction,created_at) VALUES(4,1,3,4,'generate','agent','Clarify',1);
 INSERT INTO page_version_parents(version_id,parent_version_id,page_id) VALUES(4,1,1);
 INSERT INTO page_inputs(version_id,position,page_version_id) VALUES(4,0,1);
`);
  db.orm.run(
    sql`INSERT INTO page_generation_requests(id,page_id,expected_version_id,note_id,intent_hash,created_at) VALUES('document/capture',1,1,${generationNote},${'b'.repeat(64)},1)`
  );

  return {
    db,
    async close() {
      db.close();
      await location.cleanup();
    }
  };
}

function retain(db: Awaited<ReturnType<typeof fixture>>['db']) {
  db.exec(
    "INSERT INTO page_proposals(request_id,base_version_id,proposed_version_id) VALUES('document/capture',1,4)"
  );
}

function receipt(db: Awaited<ReturnType<typeof fixture>>['db']) {
  db.exec("UPDATE page_generation_requests SET result_version_id=4 WHERE id='document/capture'");
}

const mutations = [
  ['unretained output', '', false],
  [
    'wrong expected base',
    "UPDATE page_generation_requests SET expected_version_id=3 WHERE id='document/capture'",
    true
  ],
  ['missing captured input', 'DELETE FROM page_inputs WHERE version_id=4', true],
  ['substituted exact input', 'UPDATE page_inputs SET page_version_id=3 WHERE version_id=4', true],
  [
    'extra exact input',
    'INSERT INTO page_inputs(version_id,position,page_version_id) VALUES(4,1,3)',
    true
  ],
  [
    'wrong ancestry',
    'DELETE FROM page_version_parents WHERE version_id=4; INSERT INTO page_version_parents(version_id,parent_version_id,page_id) VALUES(4,3,1)',
    true
  ],
  ['missing ancestry', 'DELETE FROM page_version_parents WHERE version_id=4', true],
  ['forged creator', "UPDATE page_versions SET creator='user' WHERE id=4", true],
  ['wrong operation', "UPDATE page_versions SET operation='edit' WHERE id=4", true],
  ['wrong instruction', "UPDATE page_versions SET instruction='Different' WHERE id=4", true],
  [
    'cancelled authority',
    "UPDATE page_transform_requests SET cancelled=1 WHERE id='document/capture'",
    true
  ],
  [
    'cancelled native execution',
    `INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,status,created_at,updated_at) VALUES('cancelled','DocumentTransformWorkflow',1,'{"event":{"correlationId":"document/capture"}}','cancelled',1,1)`,
    true
  ],
  [
    'retired request correlation',
    "INSERT INTO workflow_retired_correlations(correlation_id,event_type) VALUES('document/capture','DocumentGenerationRequested')",
    true
  ],
  [
    'deleted note',
    "INSERT INTO note_deletions(note_id,operation_id,status,created_at) VALUES(1,'delete','pending',2)",
    true
  ]
] as const;

for (const [name, mutation, retained] of mutations)
  testStable(`authored generation receipt rejects ${name}`, async () => {
    const f = await fixture();

    try {
      assert.throws(() => {
        if (mutation) f.db.exec(mutation);

        if (retained) retain(f.db);

        receipt(f.db);
      });
      assert.strictEqual(
        f.db.orm.get(
          "SELECT result_version_id FROM page_generation_requests WHERE id='document/capture'"
        )?.result_version_id,
        null
      );
    } finally {
      await f.close();
    }
  });

const invalidCaptures = [
  [
    'partial target scope',
    {
      inputs: [
        {
          input: { kind: 'page', versionId: '1' },
          snapshotId: '1',
          scope: { kind: 'blocks', blockIds: ['block-1'] }
        }
      ]
    }
  ],
  [
    'wrong captured version',
    {
      inputs: [
        {
          input: { kind: 'page', versionId: '3' },
          snapshotId: '1',
          scope: { kind: 'document' }
        }
      ]
    }
  ],
  [
    'wrong captured snapshot',
    {
      inputs: [
        {
          input: { kind: 'page', versionId: '1' },
          snapshotId: '2',
          scope: { kind: 'document' }
        }
      ]
    }
  ],
  ['wrong capture identity', { requestId: 'different' }],
  ['wrong captured note', { noteId: '2' }]
] as const;

for (const [name, patch] of invalidCaptures)
  testStable(`authored first receipt rejects ${name}`, async () => {
    const f = await fixture(patch);

    try {
      retain(f.db);
      assert.throws(() => receipt(f.db));
    } finally {
      await f.close();
    }
  });

testStable(
  'an exact retained authored proposal commits one immutable result without publishing its draft',
  async () => {
    const f = await fixture();

    try {
      retain(f.db);
      receipt(f.db);
      assert.strictEqual(
        f.db.orm.get('SELECT status FROM page_versions WHERE id=4')?.status,
        'draft'
      );
      assert.strictEqual(
        f.db.orm.get(
          "SELECT id FROM page_versions WHERE page_id=1 AND status='published' ORDER BY number DESC LIMIT 1"
        )?.id,
        3n
      );

      for (const mutation of [
        "UPDATE page_generation_requests SET result_version_id=5 WHERE id='document/capture'",
        "DELETE FROM page_generation_requests WHERE id='document/capture'",
        'DELETE FROM page_proposals',
        "UPDATE blocks SET text='forged' WHERE document_id=4",
        'DELETE FROM page_inputs WHERE version_id=4',
        'DELETE FROM page_version_parents WHERE version_id=4'
      ])
        assert.throws(() => f.db.exec(mutation));

      expect(f.db.orm.all('PRAGMA foreign_key_check')).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);

for (const [name, operation, outcome, current, result] of [
  ['draft apply result', 'apply', 'applied', 3, 4],
  ['foreign apply result', 'apply', 'applied', 3, 5],
  ['foreign current owner', 'apply', 'conflict', 5, null],
  ['draft independent result', 'keep', 'kept', 3, 4],
  ['unchanged target retained as independent', 'keep', 'kept', 3, 3]
] as const)
  testStable(`authored proposal receipts reject ${name}`, async () => {
    const f = await fixture();

    try {
      retain(f.db);
      receipt(f.db);
      assert.throws(() =>
        f.db.orm.run(
          sql`INSERT INTO page_proposal_receipts(key,request_id,operation,intent,outcome,current_version_id,result_version_id) VALUES('forged','document/capture',${operation},'{}',${outcome},${current},${result})`
        )
      );
    } finally {
      await f.close();
    }
  });

for (const result of [1, 3, 5])
  testStable(`generation cannot claim unrelated authored result ${result}`, async () => {
    const f = await fixture();

    try {
      retain(f.db);
      assert.throws(() =>
        f.db.orm.run(
          sql`UPDATE page_generation_requests SET result_version_id=${result} WHERE id='document/capture'`
        )
      );
    } finally {
      await f.close();
    }
  });

testStable(
  'authored generation cannot claim another note as its publication metadata',
  async () => {
    const f = await fixture({}, 2);

    try {
      retain(f.db);
      assert.throws(() => receipt(f.db));
    } finally {
      await f.close();
    }
  }
);
