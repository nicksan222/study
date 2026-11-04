import { cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testStable } from '@study/testing/vitest';
import { sql } from 'drizzle-orm';
import { assert, expect } from 'vite-plus/test';

import { Db } from '../src/index.ts';
import { createTestDatabase } from '../src/testing.ts';

function assertThrowsMatching(run: () => unknown, matches: (error: unknown) => boolean) {
  try {
    run();
  } catch (error) {
    assert.ok(matches(error), 'Thrown error did not match');

    return;
  }

  assert.fail('Expected function to throw');
}

const seed = `INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Project',1,1);
 INSERT INTO study_documents(id,title,created_at,updated_at) VALUES(1,'Input',1,1);
 INSERT INTO content_snapshots(id,extractor_version,meta,created_at) VALUES(1,1,'{}',1),(2,1,'{}',1);
 INSERT INTO blocks(document_id,ordinal,kind,text,anchor,editing_id,content)
 SELECT id,0,'paragraph','Evidence','{"type":"authored"}','input-'||id,'{"type":"paragraph","inlines":[{"type":"text","text":"Evidence","marks":[]}]}' FROM content_snapshots;
 INSERT INTO study_document_versions(id,document_id,number,content_snapshot_id,created_at) VALUES(1,1,1,1,1),(3,1,2,2,1);
 UPDATE study_document_versions SET status='published',published_at=2;
 INSERT INTO project_documents(project_id,document_id) VALUES(1,1);
 INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(2,'diagram','Requested',1,1);
 INSERT INTO project_materials(project_id,material_id) VALUES(1,2);
 INSERT INTO material_generation_requests(id,project_id,payload,created_at) VALUES('request',1,'{"title":"Requested","kind":"diagram","inputs":[{"kind":"document","versionId":"1"}]}',1);
 INSERT INTO material_evidence_inputs(request_id,position,document_version_id) VALUES('request',0,1);
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
  const location = createTestDatabase(process.env.STUDY_FINAL_MIGRATIONS);
  const db = location.open();

  db.exec(
    scoped
      ? seed
          .replace(
            'INSERT INTO materials',
            "INSERT INTO material_generation_scopes(id,project_id,enabled,created_at,updated_at) VALUES('scope',1,1,1,1); INSERT INTO materials"
          )
          .replace(
            '"title":"Requested","kind":"diagram","inputs"',
            '"title":"Requested","kind":"diagram","scopeId":"scope","inputs"'
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

testStable('a receipt cannot select an unrelated draft', () => {
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

testStable('captured generation intent and ordered inputs cannot be rewritten or deleted', () => {
  const { db, close } = fixture();

  try {
    assert.throws(() =>
      db.exec(
        `UPDATE material_generation_requests SET payload=json_set(payload,'$.title','Changed') WHERE id='request'`
      )
    );
    assert.throws(() =>
      db.exec(
        `UPDATE material_evidence_inputs SET document_version_id=3 WHERE request_id='request'`
      )
    );
    assert.throws(() => db.exec(`DELETE FROM material_evidence_inputs WHERE request_id='request'`));
    assert.throws(() =>
      db.exec(
        `INSERT INTO material_evidence_inputs(request_id,document_version_id,position) VALUES('request',3,1)`
      )
    );
    assert.throws(() => db.exec(`DELETE FROM material_generation_requests WHERE id='request'`));
    assert.doesNotThrow(() => db.exec('DELETE FROM projects WHERE id=1'));
  } finally {
    close();
  }
});

testStable(
  'a completed receipt stays bound to its published output and permits project deletion',
  () => {
    const { db, close } = fixture();

    try {
      db.exec(`INSERT INTO material_evidence_inputs(version_id,document_version_id,position) VALUES(2,1,0);
      UPDATE material_versions SET generation_request_id='request' WHERE id=2;
      UPDATE material_versions SET status='published',published_at=2 WHERE id=2;
      UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='request';`);
      assert.throws(() => db.exec(`DELETE FROM material_generation_requests WHERE id='request'`));
      assert.throws(() =>
        db.exec(`UPDATE material_generation_requests SET result_version_id=1 WHERE id='request'`)
      );
      assert.throws(() =>
        db.exec(`INSERT INTO material_generation_requests(id,project_id,payload,created_at) VALUES('other',1,'{"title":"Requested","kind":"diagram","inputs":["1"]}',1);
      UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='other'`)
      );
      assert.doesNotThrow(() => db.exec('DELETE FROM projects WHERE id=1'));
    } finally {
      close();
    }
  }
);

testStable('upgrade retains a completed receipt and seals its captured inputs', () => {
  const location = createTestDatabase();
  const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));
  const previous = join(location.dir, 'previous');

  try {
    for (const entry of readdirSync(migrations)) {
      if (entry < '20261029205606_ambitious_angel')
        cpSync(join(migrations, entry), join(previous, entry), { recursive: true });
    }

    const sqlite = Db.open(location.path, previous);

    try {
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

    const upgraded = Db.open(location.path, current);

    upgraded.exec('PRAGMA foreign_keys=OFF');
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

testStable('upgrade rejects a historical receipt pointing to an unrelated draft atomically', () => {
  const location = createTestDatabase();
  const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));
  const previous = join(location.dir, 'previous');

  try {
    for (const entry of readdirSync(migrations)) {
      if (entry < '20261029205606_ambitious_angel')
        cpSync(join(migrations, entry), join(previous, entry), { recursive: true });
    }

    const sqlite = Db.open(location.path, previous);

    try {
      sqlite.exec(historicalSeed);
      sqlite.exec(
        `UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='request'`
      );
    } finally {
      sqlite.close();
    }

    assertThrowsMatching(
      () => location.open(),
      (error: unknown) =>
        error instanceof Error &&
        error.cause instanceof Error &&
        'errcode' in error.cause &&
        error.cause.errcode === 1811
    );
    const retained = Db.open(location.path, previous);

    try {
      expect(
        retained.orm.get('SELECT result_version_id FROM material_generation_requests')
          ?.result_version_id
      ).toStrictEqual(2n);
      assert.strictEqual(
        retained.orm.get(
          "SELECT COUNT(*) AS count FROM pragma_table_info('material_versions') WHERE name='generation_request_id'"
        )?.count,
        0n
      );
    } finally {
      retained.close();
    }
  } finally {
    location.cleanup();
  }
});

testStable('closed scopes fence direct publication of a valid generated draft', () => {
  const { db, close } = fixture(true);

  try {
    db.exec(`INSERT INTO material_evidence_inputs(version_id,document_version_id,position) VALUES(2,1,0);
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

testStable('generation publication rejects a captured input removed from its collection', () => {
  const { db, close } = fixture();

  try {
    db.exec(
      "INSERT INTO material_evidence_inputs(version_id,document_version_id,position) VALUES(2,1,0); UPDATE material_versions SET generation_request_id='request' WHERE id=2; DELETE FROM project_documents WHERE document_id=1;"
    );
    assert.throws(() =>
      db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=2")
    );
  } finally {
    close();
  }
});

testStable('the first generation receipt rejects an input removed after output publication', () => {
  const { db, close } = fixture();

  try {
    db.exec(
      "INSERT INTO material_evidence_inputs(version_id,document_version_id,position) VALUES(2,1,0); UPDATE material_versions SET generation_request_id='request' WHERE id=2; UPDATE material_versions SET status='published',published_at=2 WHERE id=2; DELETE FROM project_documents WHERE document_id=1;"
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

testStable(
  'a committed generation receipt remains stable after its input leaves the collection',
  () => {
    const { db, close } = fixture();

    try {
      db.exec(
        "INSERT INTO material_evidence_inputs(version_id,document_version_id,position) VALUES(2,1,0); UPDATE material_versions SET generation_request_id='request' WHERE id=2; UPDATE material_versions SET status='published',published_at=2 WHERE id=2; UPDATE material_generation_requests SET result_version_id=2,result_hash='" +
          '0'.repeat(64) +
          "' WHERE id='request'; DELETE FROM project_documents WHERE document_id=1;"
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
  }
);

for (const stage of ['publication', 'receipt']) {
  testStable(
    `every captured input needs membership at first ${stage}, even when shared elsewhere`,
    () => {
      const { db, close } = fixture();

      try {
        db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES(2,'Elsewhere',1,1);
        INSERT INTO study_documents(id,title,created_at,updated_at) VALUES(3,'Second input',1,1);
        INSERT INTO content_snapshots(id,extractor_version,meta,created_at) SELECT 3,extractor_version,meta,created_at FROM content_snapshots WHERE id=1;
        INSERT INTO blocks(document_id,ordinal,kind,text,anchor,editing_id,content) SELECT 3,ordinal,kind,text,anchor,editing_id,content FROM blocks WHERE document_id=1;
        INSERT INTO study_document_versions(id,document_id,number,content_snapshot_id,created_at) VALUES(4,3,1,3,1);
        UPDATE study_document_versions SET status='published',published_at=2 WHERE id=4;
        INSERT INTO project_documents(project_id,document_id) VALUES(1,3),(2,3);
        INSERT INTO material_generation_requests(id,project_id,payload,created_at)
          VALUES('multiple',1,'{"title":"Requested","kind":"diagram","inputs":[{"kind":"document","versionId":"1"},{"kind":"document","versionId":"4"}]}',1);
        INSERT INTO material_evidence_inputs(request_id,document_version_id,position) VALUES('multiple',1,0),('multiple',4,1);
        INSERT INTO material_evidence_inputs(version_id,document_version_id,position) VALUES(2,1,0),(2,4,1);
        UPDATE material_versions SET generation_request_id='multiple' WHERE id=2;`);

        if (stage === 'receipt')
          db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=2");

        db.exec('DELETE FROM project_documents WHERE project_id=1 AND document_id=3');
        const write =
          stage === 'publication'
            ? "UPDATE material_versions SET status='published',published_at=2 WHERE id=2"
            : `UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='multiple'`;

        assertThrowsMatching(
          () => db.exec(write),
          (error: unknown) => error instanceof Error && 'errcode' in error && error.errcode === 1811
        );
        assert.strictEqual(
          db.orm.get(
            "SELECT result_version_id FROM material_generation_requests WHERE id='multiple'"
          )?.result_version_id,
          null
        );
        assert.strictEqual(
          db.orm.get('SELECT status FROM material_versions WHERE id=2')?.status,
          stage === 'publication' ? 'draft' : 'published'
        );
        db.exec('INSERT INTO project_documents(project_id,document_id) VALUES(1,3)');
        assert.doesNotThrow(() => db.exec(write));
        expect(db.orm.all('PRAGMA foreign_key_check')).toStrictEqual([]);
      } finally {
        close();
      }
    }
  );
}

testStable(
  'publication cannot replace a captured revision with another revision of the same member',
  () => {
    const { db, close } = fixture();

    try {
      db.exec("UPDATE material_versions SET generation_request_id='request' WHERE id=2");
      const publish = () =>
        db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=2");

      assert.throws(publish);
      db.exec(
        'INSERT INTO material_evidence_inputs(version_id,document_version_id,position) VALUES(2,3,1)'
      );
      assert.throws(publish);
      db.exec(
        'INSERT INTO material_evidence_inputs(version_id,document_version_id,position) VALUES(2,1,0)'
      );
      assert.throws(publish);
      db.exec('DELETE FROM material_evidence_inputs WHERE version_id=2 AND document_version_id=3');
      assert.doesNotThrow(publish);
      expect(
        db.orm
          .all('SELECT document_version_id FROM material_evidence_inputs WHERE version_id=2')
          .map((row) => row.document_version_id)
      ).toStrictEqual([1n]);
      expect(db.orm.all('PRAGMA foreign_key_check')).toStrictEqual([]);
    } finally {
      close();
    }
  }
);

const preCutoverSeed = `INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Project',1,1);
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

function triggerConstraint(error: unknown) {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;

  return cause instanceof Error && 'errcode' in cause && cause.errcode === 1811;
}

testStable(
  'the proposal guard upgrade preserves an earlier published receipt and its renamed Material',
  () => {
    const location = createTestDatabase();

    const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));

    const previous = join(location.dir, 'before-proposal-receipts');

    try {
      for (const entry of readdirSync(migrations)) {
        if (entry < '20261101225305_guard-document-proposal-receipts')
          cpSync(join(migrations, entry), join(previous, entry), { recursive: true });
      }

      const sqlite = Db.open(location.path, previous);

      try {
        sqlite.exec('PRAGMA foreign_keys=OFF');

        sqlite.exec(preCutoverSeed);

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

        assert.strictEqual(receipt?.result_version_id, 2n);

        assert.strictEqual(receipt?.result_hash, '0'.repeat(64));

        assert.doesNotThrow(() =>
          db.exec(
            `UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='request'`
          )
        );

        assertThrowsMatching(
          () =>
            db.exec(
              "UPDATE material_generation_requests SET result_version_id=NULL,result_hash=NULL WHERE id='request'"
            ),
          triggerConstraint
        );

        expect(db.orm.all('PRAGMA foreign_key_check')).toStrictEqual([]);
      } finally {
        db.close();
      }
    } finally {
      location.cleanup();
    }
  }
);

testStable(
  'session retirement upgrade preserves authored metadata and exact published content independently of private captures',
  () => {
    const location = createTestDatabase();

    const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));

    const previous = join(location.dir, 'before-session-deletion');

    try {
      for (const entry of readdirSync(migrations)) {
        if (entry < '20261102005133_session-deletion-barrier')
          cpSync(join(migrations, entry), join(previous, entry), { recursive: true });
      }

      const old = Db.open(location.path, previous);

      try {
        old.exec('PRAGMA foreign_keys=OFF');

        old.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;');

        old.exec(preCutoverSeed);

        seedPrivateSessionOutput(old.orm, 1, 4, 'OLD_PRIVATE_INSTRUCTION_8', 'documents');

        seedPrivateSessionOutput(old.orm, 2, 5, 'OTHER_PRIVATE_INSTRUCTION_8', 'documents');
      } finally {
        old.close();
      }

      let db = location.open();

      try {
        const before = retainedSessionLibrary(db);
        const versions = db.orm.all<{
          id: bigint;
          instruction: string;
          content_snapshot_id: bigint;
        }>(
          'SELECT id,instruction,content_snapshot_id FROM study_document_versions WHERE instruction IS NOT NULL ORDER BY id'
        );

        assert.strictEqual(versions.length, 2);
        expect(versions.map((v) => v.instruction)).toStrictEqual([
          'OLD_PRIVATE_INSTRUCTION_8',
          'OTHER_PRIVATE_INSTRUCTION_8'
        ]);

        for (const version of versions) {
          assertImmutableDocumentMetadata(db, version.id);

          assertThrowsMatching(
            () =>
              db.orm.run(
                sql`UPDATE blocks SET text='overwritten' WHERE document_id=${version.content_snapshot_id}`
              ),
            triggerConstraint
          );
          assertThrowsMatching(
            () =>
              db.orm.run(sql`DELETE FROM study_document_citations WHERE version_id=${version.id}`),
            triggerConstraint
          );
        }

        assert.strictEqual(
          db.orm.get("SELECT 1 FROM sqlite_schema WHERE name='session_generation_retirements'"),
          undefined
        );
        db.exec('DELETE FROM sessions WHERE id=1');
        expect(retainedSessionLibrary(db)).toStrictEqual(before);
        assert.strictEqual(
          db.orm.get("SELECT 1 FROM session_run_contexts WHERE request_id='private-1'"),
          undefined
        );
        assert.strictEqual(
          db.orm.get(
            "SELECT instruction FROM study_document_transform_requests WHERE id='document/private-1'"
          )?.instruction,
          'OLD_PRIVATE_INSTRUCTION_8'
        );
        assert.strictEqual(
          db.orm.get(
            "SELECT session_id FROM study_document_transform_requests WHERE id='document/private-1'"
          )?.session_id,
          null
        );
        db.close();
        db = location.open();
        expect(retainedSessionLibrary(db)).toStrictEqual(before);
        expect(db.orm.all('PRAGMA foreign_key_check')).toStrictEqual([]);
      } finally {
        db.close();
      }
    } finally {
      location.cleanup();
    }
  }
);

function seedPrivateSessionOutput(
  db: Db['orm'],
  sessionId: number,
  id: number,
  instruction: string,
  snapshotTable: 'documents' | 'content_snapshots' = 'content_snapshots'
) {
  const contextId = `private-${sessionId}`;

  const requestId = `document/${contextId}`;

  const snapshot = JSON.stringify({
    requestId: contextId,
    sessionId: String(sessionId),
    instruction,
    inputs: [{ versionId: '1', materialId: '1', documentId: '1', scope: { kind: 'document' } }]
  });

  const payload = JSON.stringify({
    title: `Private output ${sessionId}`,
    kind: 'document',
    instruction,
    inputVersionIds: ['1'],
    documentTransform: { contextRequestId: contextId, operations: ['clarity'] }
  });

  db.run(
    sql`INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(${sessionId},'Private session','user',1,1)`
  );

  db.run(
    sql`INSERT INTO session_run_contexts(request_id,session_id,intent_key,intent,snapshot) VALUES(${contextId},${sessionId},'private',${JSON.stringify({ instruction })},${snapshot})`
  );

  db.run(
    sql`INSERT INTO material_generation_requests(id,payload,created_at) VALUES(${requestId},${payload},1)`
  );

  db.run(
    sql`INSERT INTO material_generation_inputs(request_id,version_id,position) VALUES(${requestId},1,0)`
  );

  db.run(
    sql`INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(${id},'document',${`Private output ${sessionId}`},1,1)`
  );

  db.run(sql`INSERT INTO material_versions(id,material_id,kind,number,creator,operation,instruction,generation_request_id,language,created_at)
    VALUES(${id},${id},'document',1,'agent','generate',${instruction},${requestId},'en',1)`);

  db.run(
    sql`INSERT INTO ${sql.identifier(snapshotTable)}(id,extractor_version,meta,created_at) SELECT ${id},extractor_version,meta,created_at FROM ${sql.identifier(snapshotTable)} WHERE id=1`
  );

  db.run(sql`INSERT INTO blocks(document_id,ordinal,kind,text,anchor,editing_id,content)
    SELECT ${id},ordinal,kind,text,anchor,editing_id,content FROM blocks WHERE document_id=1`);

  db.run(sql`INSERT INTO material_document_versions(version_id,document_id) VALUES(${id},${id})`);

  db.run(sql`INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(${id},1)`);

  db.run(sql`INSERT INTO material_version_citations(version_id,marker,input_version_id,anchor,quote)
    VALUES(${id},1,1,'{"type":"page","page":1}','Evidence')`);

  db.run(sql`UPDATE material_versions SET status='published',published_at=2 WHERE id=${id}`);

  db.run(
    sql`UPDATE material_generation_requests SET result_version_id=${id},result_hash=${'0'.repeat(64)} WHERE id=${requestId}`
  );
}

function retainedSessionLibrary(db: Db) {
  return {
    documents: db.orm.all('SELECT * FROM study_documents ORDER BY id'),
    versions: db.orm.all('SELECT * FROM study_document_versions ORDER BY id'),
    snapshots: db.orm.all('SELECT * FROM content_snapshots ORDER BY id'),
    blocks: db.orm.all('SELECT * FROM blocks ORDER BY document_id,ordinal'),
    citations: db.orm.all('SELECT * FROM study_document_citations ORDER BY version_id,marker'),
    inputs: db.orm.all('SELECT * FROM study_document_inputs ORDER BY version_id,position')
  };
}

function assertImmutableDocumentMetadata(db: Db, versionId: bigint) {
  for (const assignment of [
    'instruction=NULL',
    "creator='user'",
    "operation='edit'",
    "language='it'",
    'created_at=7',
    'published_at=7',
    'document_id=999'
  ])
    assertThrowsMatching(
      () =>
        db.orm.run(
          sql.raw(`UPDATE study_document_versions SET ${assignment} WHERE id=${versionId}`)
        ),
      triggerConstraint
    );
}
