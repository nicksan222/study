import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testMigration } from '@study/testing/node';
import { sql } from 'drizzle-orm';

import { Db } from '../src/index.ts';

testMigration({ migration: 'material_metadata_migration', retention: 'permanent' })(
  'material metadata migration preserves existing rows and every invariant trigger',
  () => {
    const folder = mkdtempSync(join(tmpdir(), 'study-material-migration-'));
    const previous = join(folder, 'migrations');

    mkdirSync(previous);
    const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
    const path = join(folder, 'study.db');
    let connection: Db | undefined;

    try {
      for (const name of readdirSync(migrations))
        if (name < '20261103153249_modern_amphibian')
          cpSync(join(migrations, name), join(previous, name), { recursive: true });

      connection = Db.open(path, previous);
      connection.exec(
        "INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES (42,'document','Existing document',1,1)"
      );
      const triggers = connection.orm.all(
        sql`SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name`
      );

      connection.close();
      connection = undefined;
      connection = Db.open(path);
      assert.deepEqual(
        connection.orm.all(
          sql`SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name`
        ),
        triggers
      );
      assert.deepEqual(
        {
          ...connection.orm.get(
            sql`SELECT id,title,description,create_key,creation_intent FROM materials WHERE id=42`
          )
        },
        {
          id: 42n,
          title: 'Existing document',
          description: null,
          create_key: null,
          creation_intent: null
        }
      );
      assert.deepEqual(connection.orm.all(sql`PRAGMA foreign_key_check`), []);
      assert.throws(() =>
        connection!.orm.run(sql`UPDATE materials SET description=${'x'.repeat(241)} WHERE id=42`)
      );
      connection.exec("UPDATE materials SET create_key='receipt',creation_intent='{}' WHERE id=42");
      assert.throws(() =>
        connection!.exec(
          "INSERT INTO materials(kind,title,created_at,updated_at,create_key,creation_intent) VALUES ('document','Duplicate',1,1,'receipt','{}')"
        )
      );
    } finally {
      connection?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }
);
