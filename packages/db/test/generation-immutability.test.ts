/* eslint-disable study/database-ownership -- Upgrade test uses the official migrator to seed the preceding schema. */
import assert from 'node:assert/strict';
import { cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

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
