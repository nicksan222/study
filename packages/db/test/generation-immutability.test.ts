/* eslint-disable study/database-ownership -- Upgrade test uses the official migrator to seed the preceding schema. */
import assert from 'node:assert/strict';
import { cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

import type { Db } from '../src/index.ts';
import { createTestDatabase } from '../src/testing.ts';

const seed = `INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Project',1,1);
    INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(1,'document','Input',1,1),(2,'diagram','Requested',1,1);
    INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(1,1,'document',1,1),(3,1,'document',2,1);
    INSERT INTO documents(id,extractor_version,meta,created_at) VALUES(1,1,'{"extractor":null,"extractorVersion":1,"provider":null,"durationMs":null,"pageCount":null,"refiners":[],"waitingFor":[],"corrected":false}',1);
    INSERT INTO blocks(document_id,ordinal,kind,text,anchor,editing_id,content) VALUES(1,0,'paragraph','Evidence','{"type":"page","page":1}',lower(hex(randomblob(16))),json_object('type','paragraph','inlines',json_array(json_object('type','text','text','Evidence','marks',json_array()))));
    INSERT INTO documents(id,extractor_version,meta,created_at) SELECT 2,extractor_version,meta,created_at FROM documents WHERE id=1;
    INSERT INTO blocks(document_id,ordinal,kind,text,anchor,editing_id,content) SELECT 2,ordinal,kind,text,anchor,editing_id,content FROM blocks WHERE document_id=1;
    INSERT INTO material_document_versions(version_id,document_id) VALUES(1,1),(3,2);
    UPDATE material_versions SET status='published',published_at=2 WHERE id IN(1,3);
    INSERT OR IGNORE INTO project_materials(project_id,material_id) SELECT 1,id FROM materials;
    INSERT INTO material_generation_requests(id,project_id,payload,created_at) VALUES('request',1,'{"title":"Requested","kind":"diagram","inputVersionIds":["1"]}',1);
    INSERT INTO material_generation_inputs(request_id,version_id,position) VALUES('request',1,0);
    INSERT INTO material_versions(id,material_id,kind,number,creator,operation,created_at) VALUES(2,2,'diagram',1,'agent','generate',1);
    INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(2,'mermaid','flowchart TD; A-->B');`;

const historicalSeed = `INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Project',1,1);
    INSERT INTO materials(id,project_id,kind,title,created_at,updated_at) VALUES(1,1,'document','Input',1,1),(2,1,'diagram','Requested',1,1);
    INSERT INTO material_versions(id,material_id,project_id,kind,number,created_at) VALUES(1,1,1,'document',1,1),(3,1,1,'document',2,1);
    INSERT INTO documents(id,extractor_version,meta,created_at) VALUES(1,1,'{"extractor":null,"extractorVersion":1,"provider":null,"durationMs":null,"pageCount":null,"refiners":[],"waitingFor":[],"corrected":false}',1);
    INSERT INTO blocks(document_id,ordinal,kind,text,anchor) VALUES(1,0,'paragraph','Evidence','{"type":"page","page":1}');
    INSERT INTO documents(id,extractor_version,meta,created_at) SELECT 2,extractor_version,meta,created_at FROM documents WHERE id=1;
    INSERT INTO blocks(document_id,ordinal,kind,text,anchor) SELECT 2,ordinal,kind,text,anchor FROM blocks WHERE document_id=1;
    INSERT INTO material_document_versions(version_id,document_id) VALUES(1,1),(3,2);
    UPDATE material_versions SET status='published',published_at=2 WHERE id IN(1,3);
    INSERT INTO material_generation_requests(id,project_id,payload,created_at) VALUES('request',1,'{"title":"Requested","kind":"diagram","inputVersionIds":["1"]}',1);
    INSERT INTO material_generation_inputs(request_id,project_id,version_id,position) VALUES('request',1,1,0);
    INSERT INTO material_versions(id,material_id,project_id,kind,number,creator,operation,created_at) VALUES(2,2,1,'diagram',1,'agent','generate',1);
    INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(2,'mermaid','flowchart TD; A-->B');`;

function fixture(scoped = false) {
  const location = createTestDatabase();
  const db = location.open();

  db.exec(
    scoped
      ? seed
          .replace(
            'INSERT INTO materials',
            "INSERT INTO material_generation_scopes(id,project_id,enabled,created_at,updated_at) VALUES('scope',1,1,1,1); INSERT INTO materials"
          )
          .replace(
            '"title":"Requested","kind":"diagram","inputVersionIds"',
            '"title":"Requested","kind":"diagram","scopeId":"scope","inputVersionIds"'
          )
      : seed
  );

  return {
    db,
    close: () => {
      db.close();
      location.cleanup();
    }
  };
}

test('a receipt cannot select an unrelated draft', () => {
  const { db, close } = fixture();

  try {
    assert.throws(() =>
      db.exec(
        `UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='request'`
      )
    );
  } finally {
    close();
  }
});

test('captured generation intent and ordered inputs cannot be rewritten or deleted', () => {
  const { db, close } = fixture();

  try {
    assert.throws(() =>
      db.exec(
        `UPDATE material_generation_requests SET payload=json_set(payload,'$.title','Changed') WHERE id='request'`
      )
    );
    assert.throws(() =>
      db.exec(`UPDATE material_generation_inputs SET version_id=3 WHERE request_id='request'`)
    );
    assert.throws(() =>
      db.exec(`DELETE FROM material_generation_inputs WHERE request_id='request'`)
    );
    assert.throws(() =>
      db.exec(
        `INSERT INTO material_generation_inputs(request_id,version_id,position) VALUES('request',3,1)`
      )
    );
    assert.throws(() => db.exec(`DELETE FROM material_generation_requests WHERE id='request'`));
    assert.doesNotThrow(() => db.exec('DELETE FROM projects WHERE id=1'));
  } finally {
    close();
  }
});

test('a completed receipt stays bound to its published output and permits project deletion', () => {
  const { db, close } = fixture();

  try {
    db.exec(`INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(2,1);
      UPDATE material_versions SET generation_request_id='request' WHERE id=2;
      UPDATE material_versions SET status='published',published_at=2 WHERE id=2;
      UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='request';`);
    assert.throws(() => db.exec(`DELETE FROM material_generation_requests WHERE id='request'`));
    assert.throws(() =>
      db.exec(`UPDATE material_generation_requests SET result_version_id=1 WHERE id='request'`)
    );
    assert.throws(() =>
      db.exec(`INSERT INTO material_generation_requests(id,project_id,payload,created_at) VALUES('other',1,'{"title":"Requested","kind":"diagram","inputVersionIds":["1"]}',1);
      UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='other'`)
    );
    assert.doesNotThrow(() => db.exec('DELETE FROM projects WHERE id=1'));
  } finally {
    close();
  }
});

test('upgrade retains a completed receipt and seals its captured inputs', () => {
  const location = createTestDatabase();
  const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));
  const previous = join(location.dir, 'previous');

  try {
    for (const entry of readdirSync(migrations)) {
      if (entry < '20261029205606_ambitious_angel')
        cpSync(join(migrations, entry), join(previous, entry), { recursive: true });
    }

    const sqlite = new DatabaseSync(location.path);

    try {
      migrate(drizzle({ client: sqlite }), { migrationsFolder: previous });
      sqlite.exec(historicalSeed);
      sqlite.exec(`UPDATE material_generation_requests SET payload=json_remove(payload,'$.inputVersionIds');
        INSERT INTO material_version_inputs(version_id,input_version_id,project_id) VALUES(2,1,1);
        UPDATE material_versions SET status='published',published_at=2 WHERE id=2;
        UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='request';
        UPDATE materials SET title='Renamed after publication',updated_at=2 WHERE id=2;`);
    } finally {
      sqlite.close();
    }

    const current = join(location.dir, 'receipt-upgrade');

    for (const entry of readdirSync(migrations)) {
      if (entry < '20261101161641_romantic_miss_america')
        cpSync(join(migrations, entry), join(current, entry), { recursive: true });
    }

    const upgraded = new DatabaseSync(location.path);

    upgraded.exec('PRAGMA foreign_keys=OFF');
    migrate(drizzle({ client: upgraded }), { migrationsFolder: current });
    upgraded.exec('PRAGMA foreign_keys=ON');

    try {
      assert.throws(() =>
        upgraded.exec(`UPDATE material_generation_requests SET payload='{}' WHERE id='request'`)
      );
      assert.throws(() =>
        upgraded.exec(`UPDATE material_versions SET generation_request_id=NULL WHERE id=2`)
      );
      assert.doesNotThrow(() =>
        upgraded.exec(
          `UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='request'`
        )
      );
      assert.doesNotThrow(() => upgraded.exec('DELETE FROM projects WHERE id=1'));
    } finally {
      upgraded.close();
    }
  } finally {
    location.cleanup();
  }
});

test('upgrade rejects a historical receipt pointing to an unrelated draft atomically', () => {
  const location = createTestDatabase();
  const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));
  const previous = join(location.dir, 'previous');

  try {
    for (const entry of readdirSync(migrations)) {
      if (entry < '20261029205606_ambitious_angel')
        cpSync(join(migrations, entry), join(previous, entry), { recursive: true });
    }

    const sqlite = new DatabaseSync(location.path);

    try {
      migrate(drizzle({ client: sqlite }), { migrationsFolder: previous });
      sqlite.exec(historicalSeed);
      sqlite.exec(
        `UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='request'`
      );
    } finally {
      sqlite.close();
    }

    assert.throws(
      () => location.open(),
      (error: unknown) =>
        error instanceof Error &&
        error.cause instanceof Error &&
        'errcode' in error.cause &&
        error.cause.errcode === 1811
    );
    const retained = new DatabaseSync(location.path);

    try {
      assert.deepEqual(
        retained.prepare('SELECT result_version_id FROM material_generation_requests').get()
          ?.result_version_id,
        2
      );
      assert.equal(
        retained
          .prepare(
            "SELECT COUNT(*) AS count FROM pragma_table_info('material_versions') WHERE name='generation_request_id'"
          )
          .get()?.count,
        0
      );
    } finally {
      retained.close();
    }
  } finally {
    location.cleanup();
  }
});

test('closed scopes fence direct publication of a valid generated draft', () => {
  const { db, close } = fixture(true);

  try {
    db.exec(`INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(2,1);
      UPDATE material_versions SET generation_request_id='request' WHERE id=2;
      UPDATE material_generation_scopes SET enabled=0,updated_at=2 WHERE id='scope';`);
    assert.throws(
      () => db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=2"),
      /scope is not active/
    );
    assert.doesNotThrow(() => db.exec('DELETE FROM projects WHERE id=1'));
  } finally {
    close();
  }
});

test('generation publication rejects a captured input removed from its collection', () => {
  const { db, close } = fixture();

  try {
    db.exec(
      "INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(2,1); UPDATE material_versions SET generation_request_id='request' WHERE id=2; DELETE FROM project_materials WHERE material_id=1;"
    );
    assert.throws(() =>
      db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=2")
    );
  } finally {
    close();
  }
});

test('the first generation receipt rejects an input removed after output publication', () => {
  const { db, close } = fixture();

  try {
    db.exec(
      "INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(2,1); UPDATE material_versions SET generation_request_id='request' WHERE id=2; UPDATE material_versions SET status='published',published_at=2 WHERE id=2; DELETE FROM project_materials WHERE material_id=1;"
    );
    assert.throws(() =>
      db.exec(
        "UPDATE material_generation_requests SET result_version_id=2,result_hash='" +
          '0'.repeat(64) +
          "' WHERE id='request'"
      )
    );
  } finally {
    close();
  }
});

test('a committed generation receipt remains stable after its input leaves the collection', () => {
  const { db, close } = fixture();

  try {
    db.exec(
      "INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(2,1); UPDATE material_versions SET generation_request_id='request' WHERE id=2; UPDATE material_versions SET status='published',published_at=2 WHERE id=2; UPDATE material_generation_requests SET result_version_id=2,result_hash='" +
        '0'.repeat(64) +
        "' WHERE id='request'; DELETE FROM project_materials WHERE material_id=1;"
    );
    assert.doesNotThrow(() =>
      db.exec(
        "UPDATE material_generation_requests SET result_version_id=2,result_hash='" +
          '0'.repeat(64) +
          "' WHERE id='request'"
      )
    );
    assert.throws(() =>
      db.exec(
        "UPDATE material_generation_requests SET result_hash='" +
          '1'.repeat(64) +
          "' WHERE id='request'"
      )
    );
  } finally {
    close();
  }
});

for (const stage of ['publication', 'receipt']) {
  test(`every captured input needs membership at first ${stage}, even when shared elsewhere`, () => {
    const { db, close } = fixture();

    try {
      db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES(2,'Elsewhere',1,1);
        INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(3,'document','Second input',1,1);
        INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(4,3,'document',1,1);
        INSERT INTO documents(id,extractor_version,meta,created_at) SELECT 3,extractor_version,meta,created_at FROM documents WHERE id=1;
        INSERT INTO blocks(document_id,ordinal,kind,text,anchor,editing_id,content) SELECT 3,ordinal,kind,text,anchor,editing_id,content FROM blocks WHERE document_id=1;
        INSERT INTO material_document_versions(version_id,document_id) VALUES(4,3);
        UPDATE material_versions SET status='published',published_at=2 WHERE id=4;
        INSERT INTO project_materials(project_id,material_id) VALUES(1,3),(2,3);
        INSERT INTO material_generation_requests(id,project_id,payload,created_at)
          VALUES('multiple',1,'{"title":"Requested","kind":"diagram","inputVersionIds":["1","4"]}',1);
        INSERT INTO material_generation_inputs(request_id,version_id,position) VALUES('multiple',1,0),('multiple',4,1);
        INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(2,1),(2,4);
        UPDATE material_versions SET generation_request_id='multiple' WHERE id=2;`);

      if (stage === 'receipt')
        db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=2");

      db.exec('DELETE FROM project_materials WHERE project_id=1 AND material_id=3');
      const write =
        stage === 'publication'
          ? "UPDATE material_versions SET status='published',published_at=2 WHERE id=2"
          : `UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='multiple'`;

      assert.throws(
        () => db.exec(write),
        (error: unknown) => error instanceof Error && 'errcode' in error && error.errcode === 1811
      );
      assert.equal(
        db.orm.get("SELECT result_version_id FROM material_generation_requests WHERE id='multiple'")
          ?.result_version_id,
        null
      );
      assert.equal(
        db.orm.get('SELECT status FROM material_versions WHERE id=2')?.status,
        stage === 'publication' ? 'draft' : 'published'
      );
      db.exec('INSERT INTO project_materials(project_id,material_id) VALUES(1,3)');
      assert.doesNotThrow(() => db.exec(write));
      assert.deepEqual(db.orm.all('PRAGMA foreign_key_check'), []);
    } finally {
      close();
    }
  });
}

test('publication cannot replace a captured revision with another revision of the same member', () => {
  const { db, close } = fixture();

  try {
    db.exec("UPDATE material_versions SET generation_request_id='request' WHERE id=2");
    const publish = () =>
      db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=2");

    assert.throws(publish);
    db.exec('INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(2,3)');
    assert.throws(publish);
    db.exec('INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(2,1)');
    assert.throws(publish);
    db.exec('DELETE FROM material_version_inputs WHERE version_id=2 AND input_version_id=3');
    assert.doesNotThrow(publish);
    assert.deepEqual(
      db.orm
        .all('SELECT input_version_id FROM material_version_inputs WHERE version_id=2')
        .map((row) => row.input_version_id),
      [1n]
    );
    assert.deepEqual(db.orm.all('PRAGMA foreign_key_check'), []);
  } finally {
    close();
  }
});

function proposalFixture(
  captureMutation?: { path: string; value: string },
  targetId: string | null = '1',
  outputMaterialId: 1 | 3 = 1,
  outputRequestId: 'document/capture' | 'request' = 'document/capture'
) {
  const f = fixture();

  try {
    f.db.exec(
      "INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(1,'Proposal','user',1,1),(2,'Other','user',1,1)"
    );

    const capture = JSON.stringify({
      requestId: 'capture',
      sessionId: '1',
      inputs: [{ versionId: '1', materialId: '1', documentId: '1', scope: { kind: 'document' } }]
    });

    const snapshot =
      captureMutation === undefined
        ? sql`${capture}`
        : sql`json_set(${capture},${captureMutation.path},${captureMutation.value})`;

    f.db.orm
      .run(sql`INSERT INTO session_run_contexts(request_id,session_id,intent_key,intent,snapshot)
      VALUES('capture',1,'proposal','{}',${snapshot})`);

    const payload = JSON.stringify({
      title: 'Proposal',
      kind: 'document',
      inputVersionIds: ['1'],
      documentTransform: {
        contextRequestId: 'capture',
        operations: ['clarity'],
        ...(targetId === null ? {} : { editTargetVersionId: targetId })
      }
    });

    f.db.orm.run(
      sql`INSERT INTO material_generation_requests(id,payload,created_at) VALUES('document/capture',${payload},1)`
    );

    if (outputMaterialId === 3)
      f.db.exec(
        "INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(3,'document','Wrong target',1,1)"
      );

    f.db.orm
      .run(sql`INSERT INTO material_versions(id,material_id,kind,number,creator,operation,generation_request_id,created_at)
      VALUES(4,${outputMaterialId},'document',3,'agent','generate',${outputRequestId},1)`);

    f.db.exec(`
      INSERT INTO material_generation_inputs(request_id,version_id,position) VALUES('document/capture',1,0);
      INSERT INTO documents(id,extractor_version,meta,created_at) SELECT 3,extractor_version,meta,created_at FROM documents WHERE id=1;
      INSERT INTO blocks(document_id,ordinal,kind,text,anchor,editing_id,content)
      SELECT 3,ordinal,kind,text,anchor,lower(hex(randomblob(16))),content FROM blocks WHERE document_id=1;
      INSERT INTO material_document_versions(version_id,document_id) VALUES(4,3);
      INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(4,1);
    `);

    if (outputMaterialId === 1)
      f.db.exec(
        'INSERT INTO material_version_parents(version_id,parent_version_id,material_id) VALUES(4,1,1)'
      );

    return f;
  } catch (error) {
    f.close();

    throw error;
  }
}

function retainProposal(db: Db) {
  db.exec(`INSERT INTO document_proposals(request_id,session_id,base_version_id,proposed_version_id)
    VALUES('document/capture',1,1,4)`);
}

function recordProposalReceipt(db: Db, hash = '0'.repeat(64)) {
  db.orm.run(sql`UPDATE material_generation_requests
    SET result_version_id=4,result_hash=${hash},result_metadata=${'{"notes":[{"kind":"limit","explanation":"Structural only","blockIds":[]}]}'}
    WHERE id='document/capture'`);
}

function triggerConstraint(error: unknown) {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;

  return cause instanceof Error && 'errcode' in cause && cause.errcode === 1811;
}

// Each fixture is a migrated file. Mutate before retention so failures exercise
// first-receipt validation rather than the immutable retained-output guards.
const invalidDraftReceipts = [
  ['unretained output', '', false],
  ['wrong base revision', "INSERT INTO document_proposals VALUES('document/capture',1,3,4)", false],
  ['wrong session', "INSERT INTO document_proposals VALUES('document/capture',2,1,4)", false],
  ['wrong request', '', true, 'request'],
  ['missing captured input', 'DELETE FROM material_version_inputs WHERE version_id=4', true],
  [
    'substituted input revision',
    'UPDATE material_version_inputs SET input_version_id=3 WHERE version_id=4',
    true
  ],
  ['extra input revision', 'INSERT INTO material_version_inputs VALUES(4,3)', true],
  [
    'wrong parent revision',
    'UPDATE material_version_parents SET parent_version_id=3 WHERE version_id=4',
    true
  ],
  ['missing parent', 'DELETE FROM material_version_parents WHERE version_id=4', true],
  ['forged creator', "UPDATE material_versions SET creator='user' WHERE id=4", true],
  ['wrong operation', "UPDATE material_versions SET operation='edit' WHERE id=4", true],
  ['wrong instruction', "UPDATE material_versions SET instruction='Different' WHERE id=4", true]
] as const;

for (const [name, mutation, retain, outputRequestId] of invalidDraftReceipts) {
  test(`draft generation receipt rejects ${name}`, () => {
    // Bind at insertion: changing an existing request binding is independently forbidden.
    const { db, close } = proposalFixture(undefined, '1', 1, outputRequestId);

    try {
      if (mutation) db.exec(mutation);

      if (retain) retainProposal(db);

      assert.throws(() => recordProposalReceipt(db), triggerConstraint);

      assert.equal(
        db.orm.get(
          "SELECT result_version_id FROM material_generation_requests WHERE id='document/capture'"
        )?.result_version_id,
        null
      );

      assert.equal(db.orm.get('SELECT status FROM material_versions WHERE id=4')?.status, 'draft');

      assert.deepEqual(db.orm.all('PRAGMA foreign_key_check'), []);
    } finally {
      close();
    }
  });
}

test('a receipt cannot retain a draft from a different target Material', () => {
  const { db, close } = proposalFixture(undefined, '1', 3);

  try {
    retainProposal(db);

    assert.throws(() => recordProposalReceipt(db), triggerConstraint);

    assert.equal(
      db.orm.get('SELECT material_id FROM material_versions WHERE id=4')?.material_id,
      3n
    );

    assert.equal(
      db.orm.get(
        "SELECT result_version_id FROM material_generation_requests WHERE id='document/capture'"
      )?.result_version_id,
      null
    );

    assert.deepEqual(db.orm.all('PRAGMA foreign_key_check'), []);
  } finally {
    close();
  }
});

for (const [name, path, value] of [
  ['partial target scope', '$.inputs[0].scope.kind', 'blocks'],
  ['wrong captured Material', '$.inputs[0].materialId', '2'],
  ['wrong captured Document', '$.inputs[0].documentId', '2'],
  ['wrong capture identity', '$.requestId', 'other'],
  ['wrong captured session', '$.sessionId', '2']
] as const) {
  test(`draft generation receipt rejects ${name}`, () => {
    const { db, close } = proposalFixture({ path, value });

    try {
      retainProposal(db);

      assert.throws(() => recordProposalReceipt(db), triggerConstraint);

      assert.equal(
        db.orm.get(
          "SELECT result_version_id FROM material_generation_requests WHERE id='document/capture'"
        )?.result_version_id,
        null
      );
    } finally {
      close();
    }
  });
}

for (const barrier of [
  "UPDATE material_generation_requests SET cancelled=1 WHERE id='document/capture'",
  'DELETE FROM sessions WHERE id=1'
]) {
  test(`retained draft receipt preserves the publication barrier: ${barrier}`, () => {
    const { db, close } = proposalFixture();

    try {
      retainProposal(db);

      db.exec(barrier);

      assert.throws(() => recordProposalReceipt(db), triggerConstraint);
    } finally {
      close();
    }
  });
}

test('an exact retained proposal can commit a draft receipt without publishing or weakening immutability', () => {
  const { db, close } = proposalFixture();

  try {
    retainProposal(db);

    assert.throws(() => recordProposalReceipt(db, 'g'.repeat(64)), triggerConstraint);

    recordProposalReceipt(db);

    assert.equal(db.orm.get('SELECT status FROM material_versions WHERE id=4')?.status, 'draft');

    assert.equal(
      db.orm.get(
        "SELECT result_version_id FROM material_generation_requests WHERE id='document/capture'"
      )?.result_version_id,
      4n
    );

    for (const mutation of [
      "UPDATE material_versions SET published_at=2,status='published' WHERE id=4",
      "UPDATE blocks SET text='Forged' WHERE document_id=3",
      'DELETE FROM material_document_versions WHERE version_id=4',
      'DELETE FROM material_version_inputs WHERE version_id=4',
      'DELETE FROM material_version_parents WHERE version_id=4',
      'DELETE FROM document_proposals',
      "UPDATE material_generation_requests SET result_hash='" +
        '1'.repeat(64) +
        "' WHERE id='document/capture'",
      "UPDATE material_generation_requests SET result_metadata='{}' WHERE id='document/capture'"
    ])
      assert.throws(() => db.exec(mutation), triggerConstraint);

    db.exec('DELETE FROM sessions WHERE id=1');

    assert.doesNotThrow(() => recordProposalReceipt(db));

    assert.deepEqual(db.orm.all('PRAGMA foreign_key_check'), []);
  } finally {
    close();
  }
});

for (const targetId of [null, '3']) {
  test(`a retained draft cannot bypass the exact request target ${targetId}`, () => {
    const { db, close } = proposalFixture(undefined, targetId);

    try {
      retainProposal(db);

      assert.throws(() => recordProposalReceipt(db), triggerConstraint);
    } finally {
      close();
    }
  });
}

test('the proposal guard upgrade preserves an earlier published receipt and its renamed Material', () => {
  const location = createTestDatabase();

  const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));

  const previous = join(location.dir, 'before-proposal-receipts');

  try {
    for (const entry of readdirSync(migrations)) {
      if (entry < '20261101225305_guard-document-proposal-receipts')
        cpSync(join(migrations, entry), join(previous, entry), { recursive: true });
    }

    const sqlite = new DatabaseSync(location.path);

    try {
      sqlite.exec('PRAGMA foreign_keys=OFF');

      migrate(drizzle({ client: sqlite }), { migrationsFolder: previous });

      sqlite.exec(seed);

      sqlite.exec(`INSERT INTO material_version_inputs VALUES(2,1);
        UPDATE material_versions SET generation_request_id='request' WHERE id=2;
        UPDATE material_versions SET status='published',published_at=2 WHERE id=2;
        UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='request';
        UPDATE materials SET title='Renamed after receipt' WHERE id=2;`);
    } finally {
      sqlite.close();
    }

    const db = location.open();

    try {
      const receipt = db.orm.get(
        "SELECT result_version_id,result_hash FROM material_generation_requests WHERE id='request'"
      );

      assert.equal(receipt?.result_version_id, 2n);

      assert.equal(receipt?.result_hash, '0'.repeat(64));

      assert.doesNotThrow(() =>
        db.exec(
          `UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='request'`
        )
      );

      assert.throws(
        () =>
          db.exec(
            "UPDATE material_generation_requests SET result_version_id=NULL,result_hash=NULL WHERE id='request'"
          ),
        triggerConstraint
      );

      assert.deepEqual(db.orm.all('PRAGMA foreign_key_check'), []);
    } finally {
      db.close();
    }
  } finally {
    location.cleanup();
  }
});
