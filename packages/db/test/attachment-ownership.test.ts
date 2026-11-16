import { test } from '@study/testing';
import { sql } from 'drizzle-orm';

import type { Db } from '../src/index.ts';

type Databases = (migrationsFolder?: string) => Promise<{ open(): Promise<Db> }>;

async function fixture(databases: Databases, run: (db: Db) => void) {
  const location = await databases();
  const db = await location.open();

  {
    db.exec(`
      INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'One',1,1),(2,'Two',1,1);
      INSERT INTO notes(id,title,title_source,created_at,updated_at)
        VALUES(1,'One','user',1,1),(2,'Two','user',1,1),(3,'Other','user',1,1);
      INSERT INTO messages(id,note_id,role,created_at) VALUES(1,1,'user',1),(2,2,'user',1),(3,3,'user',1);
      INSERT INTO sources(id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at)
        VALUES(1,1,'attachment','text','text/plain','One',1,zeroblob(32),1),
              (2,2,'attachment','text','text/plain','Two',1,zeroblob(32),1),
              (3,NULL,'attachment','text','text/plain','Unassigned',1,zeroblob(32),1);
      INSERT INTO message_parts(id,message_id,ordinal,source_id,source_name,source_kind)
        VALUES(1,1,0,1,'One','text');
    `);
    run(db);
  }
}

test.stable(
  'explicit attachment selection crosses collections and still rejects missing sources',
  async ({ databases }) =>
    await fixture(databases, (db) => {
      db.exec(
        "INSERT INTO message_parts(message_id,ordinal,source_id,source_name,source_kind) VALUES(1,1,2,'Shared','text')"
      );
      test.assert.throws(() =>
        db.exec(
          "INSERT INTO message_parts(message_id,ordinal,source_id,source_name,source_kind) VALUES(1,2,999,'Missing','text')"
        )
      );
      db.exec('UPDATE sources SET project_id=NULL WHERE id=1');
      test.assert.strictEqual(
        db.orm.get(sql`SELECT source_id FROM message_parts WHERE id=1`)?.source_id,
        1n
      );
    })
);

test.stable(
  'source cleanup and note or project cascades remain possible',
  async ({ databases }) => {
    await fixture(databases, (db) => {
      db.exec('DELETE FROM sources WHERE id=1');
      test.assert.strictEqual(
        db.orm.get<{ source_id: bigint | null }>(
          sql`SELECT source_id FROM message_parts WHERE id=1`
        )?.source_id,
        null
      );
    });
    await fixture(databases, (db) => {
      db.exec('DELETE FROM notes WHERE id=1');
      test.assert.strictEqual(db.orm.get(sql`SELECT id FROM message_parts WHERE id=1`), undefined);
    });
    await fixture(databases, (db) => {
      db.exec('DELETE FROM projects WHERE id=1');
      test.assert.strictEqual(db.orm.get(sql`SELECT id FROM message_parts WHERE id=1`)?.id, 1n);
      test.expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    });
  }
);
