import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';
import { sql } from 'drizzle-orm';

import { createTestDatabase } from '../src/testing.ts';

function fixture(patch: Record<string, unknown> = {}, generationSession: number | null = null) {
  const location = createTestDatabase(process.env.STUDY_FINAL_MIGRATIONS);
  const db = location.open();
  db.exec(`INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(1,'Proposal','user',1,1),(2,'Other','user',1,1);
 INSERT INTO study_documents(id,title,created_at,updated_at) VALUES(1,'Target',1,1),(3,'Other',1,1);
 INSERT INTO content_snapshots(id,extractor_version,meta,created_at) VALUES(1,1,'{}',1),(2,1,'{}',1),(3,1,'{}',1),(4,1,'{}',1);
 INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor)
 SELECT id,0,'paragraph','block-'||id,'{"type":"paragraph","inlines":[{"type":"text","text":"Evidence","marks":[]}]}','Evidence','{"type":"authored"}' FROM content_snapshots;
 INSERT INTO study_document_versions(id,document_id,number,content_snapshot_id,created_at) VALUES(1,1,1,1,1),(3,1,2,2,1),(5,3,1,3,1);
 UPDATE study_document_versions SET status='published',published_at=2;
`);
  const capture = {
    requestId: 'capture',
    sessionId: '1',
    inputs: [
      { input: { kind: 'document', versionId: '1' }, snapshotId: '1', scope: { kind: 'document' } }
    ],
    messages: [],
    ...patch
  };
  db.orm.run(
    sql`INSERT INTO session_run_contexts(request_id,session_id,intent_key,intent,snapshot) VALUES('capture',1,'proposal','{}',${JSON.stringify(capture)})`
  );
  db.exec(` INSERT INTO session_context_documents(request_id,version_id) VALUES('capture',1);
 INSERT INTO study_document_transform_requests(id,context_request_id,session_id,request,intent_hash,instruction,event_id,created_at)
 VALUES('document/capture','capture',1,'{"title":"Proposal","contextRequestId":"capture","operations":["clarity"],"editTargetVersionId":"1"}','${'a'.repeat(64)}','Clarify','event',1);
 INSERT INTO study_document_versions(id,document_id,number,content_snapshot_id,operation,creator,instruction,created_at) VALUES(4,1,3,4,'generate','agent','Clarify',1);
 INSERT INTO study_document_version_parents(version_id,parent_version_id,document_id) VALUES(4,1,1);
 INSERT INTO study_document_inputs(version_id,position,document_version_id) VALUES(4,0,1);
`);
  db.orm.run(
    sql`INSERT INTO study_document_generation_requests(id,document_id,expected_version_id,session_id,intent_hash,created_at) VALUES('document/capture',1,1,${generationSession},${'b'.repeat(64)},1)`
  );
  return {
    db,
    close() {
      db.close();
      location.cleanup();
    }
  };
}
function retain(db: ReturnType<typeof fixture>['db']) {
  db.exec(
    "INSERT INTO study_document_proposals(request_id,base_version_id,proposed_version_id) VALUES('document/capture',1,4)"
  );
}
function receipt(db: ReturnType<typeof fixture>['db']) {
  db.exec(
    "UPDATE study_document_generation_requests SET result_version_id=4 WHERE id='document/capture'"
  );
}
const mutations = [
  ['unretained output', '', false],
  [
    'wrong expected base',
    "UPDATE study_document_generation_requests SET expected_version_id=3 WHERE id='document/capture'",
    true
  ],
  ['missing captured input', 'DELETE FROM study_document_inputs WHERE version_id=4', true],
  [
    'substituted exact input',
    'UPDATE study_document_inputs SET document_version_id=3 WHERE version_id=4',
    true
  ],
  [
    'extra exact input',
    'INSERT INTO study_document_inputs(version_id,position,document_version_id) VALUES(4,1,3)',
    true
  ],
  [
    'wrong ancestry',
    'DELETE FROM study_document_version_parents WHERE version_id=4; INSERT INTO study_document_version_parents(version_id,parent_version_id,document_id) VALUES(4,3,1)',
    true
  ],
  ['missing ancestry', 'DELETE FROM study_document_version_parents WHERE version_id=4', true],
  ['forged creator', "UPDATE study_document_versions SET creator='user' WHERE id=4", true],
  ['wrong operation', "UPDATE study_document_versions SET operation='edit' WHERE id=4", true],
  [
    'wrong instruction',
    "UPDATE study_document_versions SET instruction='Different' WHERE id=4",
    true
  ],
  [
    'cancelled authority',
    "UPDATE study_document_transform_requests SET cancelled=1 WHERE id='document/capture'",
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
    'deleted session',
    "INSERT INTO session_deletions(session_id,operation_id,status,created_at) VALUES(1,'delete','pending',2)",
    true
  ]
] as const;
for (const [name, mutation, retained] of mutations)
  testStable(`authored generation receipt rejects ${name}`, () => {
    const f = fixture();
    try {
      assert.throws(() => {
        if (mutation) f.db.exec(mutation);
        if (retained) retain(f.db);
        receipt(f.db);
      });
      assert.equal(
        f.db.orm.get(
          "SELECT result_version_id FROM study_document_generation_requests WHERE id='document/capture'"
        )?.result_version_id,
        null
      );
    } finally {
      f.close();
    }
  });
const invalidCaptures = [
  [
    'partial target scope',
    {
      inputs: [
        {
          input: { kind: 'document', versionId: '1' },
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
          input: { kind: 'document', versionId: '3' },
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
          input: { kind: 'document', versionId: '1' },
          snapshotId: '2',
          scope: { kind: 'document' }
        }
      ]
    }
  ],
  ['wrong capture identity', { requestId: 'different' }],
  ['wrong captured session', { sessionId: '2' }]
] as const;
for (const [name, patch] of invalidCaptures)
  testStable(`authored first receipt rejects ${name}`, () => {
    const f = fixture(patch);
    try {
      retain(f.db);
      assert.throws(() => receipt(f.db));
    } finally {
      f.close();
    }
  });

testStable(
  'an exact retained authored proposal commits one immutable result without publishing its draft',
  () => {
    const f = fixture();
    try {
      retain(f.db);
      receipt(f.db);
      assert.equal(
        f.db.orm.get('SELECT status FROM study_document_versions WHERE id=4')?.status,
        'draft'
      );
      assert.equal(
        f.db.orm.get(
          "SELECT id FROM study_document_versions WHERE document_id=1 AND status='published' ORDER BY number DESC LIMIT 1"
        )?.id,
        3n
      );
      for (const mutation of [
        "UPDATE study_document_generation_requests SET result_version_id=5 WHERE id='document/capture'",
        "DELETE FROM study_document_generation_requests WHERE id='document/capture'",
        'DELETE FROM study_document_proposals',
        "UPDATE blocks SET text='forged' WHERE document_id=4",
        'DELETE FROM study_document_inputs WHERE version_id=4',
        'DELETE FROM study_document_version_parents WHERE version_id=4'
      ])
        assert.throws(() => f.db.exec(mutation));
      assert.deepEqual(f.db.orm.all('PRAGMA foreign_key_check'), []);
    } finally {
      f.close();
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
  testStable(`authored proposal receipts reject ${name}`, () => {
    const f = fixture();
    try {
      retain(f.db);
      receipt(f.db);
      assert.throws(() =>
        f.db.orm.run(
          sql`INSERT INTO study_document_proposal_receipts(key,request_id,operation,intent,outcome,current_version_id,result_version_id) VALUES('forged','document/capture',${operation},'{}',${outcome},${current},${result})`
        )
      );
    } finally {
      f.close();
    }
  });

for (const result of [1, 3, 5])
  testStable(`generation cannot claim unrelated authored result ${result}`, () => {
    const f = fixture();
    try {
      retain(f.db);
      assert.throws(() =>
        f.db.orm.run(
          sql`UPDATE study_document_generation_requests SET result_version_id=${result} WHERE id='document/capture'`
        )
      );
    } finally {
      f.close();
    }
  });

testStable('authored generation cannot claim another session as its publication metadata', () => {
  const f = fixture({}, 2);
  try {
    retain(f.db);
    assert.throws(() => receipt(f.db));
  } finally {
    f.close();
  }
});
