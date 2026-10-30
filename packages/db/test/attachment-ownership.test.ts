import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sql } from 'drizzle-orm';

import { createTestDatabase } from '../src/testing.ts';

function fixture(run: (db: ReturnType<ReturnType<typeof createTestDatabase>['open']>) => void) {
  const location = createTestDatabase();
  const db = location.open();

  try {
    db.exec(`
      INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'One',1,1),(2,'Two',1,1);
      INSERT INTO sessions(id,project_id,title,title_source,created_at,updated_at)
        VALUES(1,1,'One','user',1,1),(2,2,'Two','user',1,1),(3,1,'Other','user',1,1);
      INSERT INTO messages(id,session_id,role,created_at) VALUES(1,1,'user',1),(2,2,'user',1),(3,3,'user',1);
      INSERT INTO sources(id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at)
        VALUES(1,1,'attachment','text','text/plain','One',1,zeroblob(32),1),
              (2,2,'attachment','text','text/plain','Two',1,zeroblob(32),1),
              (3,NULL,'attachment','text','text/plain','Unassigned',1,zeroblob(32),1);
      INSERT INTO message_parts(id,message_id,ordinal,source_id,source_name,source_kind)
        VALUES(1,1,0,1,'One','text');
    `);
    run(db);
  } finally {
    db.close();
    location.cleanup();
  }
}

function mismatch(action: () => void) {
  assert.throws(action, /attachment source project mismatch/);
}

test('raw attachment writes preserve source and session project ownership', () =>
  fixture((db) => {
    for (const sourceId of [2, 3])
      mismatch(() =>
        db.exec(
          `INSERT INTO message_parts(message_id,ordinal,source_id,source_name,source_kind) VALUES(1,1,${sourceId},'Invalid','text')`
        )
      );

    mismatch(() => db.exec('UPDATE message_parts SET source_id=2 WHERE id=1'));
    mismatch(() => db.exec('UPDATE message_parts SET source_id=3 WHERE id=1'));
    mismatch(() => db.exec('UPDATE message_parts SET message_id=2 WHERE id=1'));
    db.exec('UPDATE message_parts SET source_id=1,message_id=3 WHERE id=1');
    db.exec('UPDATE message_parts SET source_id=NULL,message_id=2 WHERE id=1');
    db.exec('UPDATE message_parts SET source_id=2 WHERE id=1');
  }));

test('raw owner changes cannot invalidate attachments but allow valid moves and no-ops', () =>
  fixture((db) => {
    mismatch(() => db.exec('UPDATE sources SET project_id=2 WHERE id=1'));
    mismatch(() => db.exec('UPDATE sources SET project_id=NULL WHERE id=1'));
    mismatch(() => db.exec('UPDATE messages SET session_id=2 WHERE id=1'));
    mismatch(() => db.exec('UPDATE sessions SET project_id=2 WHERE id=1'));
    db.exec('UPDATE sources SET project_id=1 WHERE id=1');
    db.exec('UPDATE messages SET session_id=3 WHERE id=1');
    db.exec('UPDATE sessions SET project_id=1 WHERE id=3');
    db.exec('UPDATE message_parts SET source_id=NULL WHERE id=1');
    db.exec('UPDATE sources SET project_id=NULL WHERE id=1');
    db.exec('UPDATE messages SET session_id=2 WHERE id=1');
    db.exec('UPDATE sessions SET project_id=2 WHERE id=3');
  }));

test('source cleanup and session or project cascades remain possible', () => {
  fixture((db) => {
    db.exec('DELETE FROM sources WHERE id=1');
    assert.equal(
      db.orm.get<{ source_id: bigint | null }>(sql`SELECT source_id FROM message_parts WHERE id=1`)
        ?.source_id,
      null
    );
  });
  fixture((db) => {
    db.exec('DELETE FROM sessions WHERE id=1');
    assert.equal(db.orm.get(sql`SELECT id FROM message_parts WHERE id=1`), undefined);
  });
  fixture((db) => {
    db.exec('DELETE FROM projects WHERE id=1');
    assert.equal(db.orm.get(sql`SELECT id FROM message_parts WHERE id=1`), undefined);
    assert.deepEqual(db.orm.all(sql`PRAGMA foreign_key_check`), []);
  });
});
