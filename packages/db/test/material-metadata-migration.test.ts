import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testMigration } from '@study/testing/vitest';
import { sql } from 'drizzle-orm';
import { assert, expect } from 'vite-plus/test';

import { Db } from '../src/index.ts';

testMigration({ migration: 'material_metadata_migration', retention: 'permanent' })(
  'material metadata migration preserves existing rows and the retained learning invariants',
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
        "INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES (42,'diagram','Existing diagram',1,1)"
      );
      const triggers = connection.orm.all(
        sql`SELECT name,replace(replace(sql,'documents','content_snapshots'),'"','') AS sql FROM sqlite_schema WHERE type='trigger' AND name IN('material_identity_update','material_versions_start_draft','material_diagram_versions_insert_draft') ORDER BY name`
      );

      connection.close();
      connection = undefined;
      connection = Db.open(path);
      expect(
        connection.orm
          .all(
            sql`SELECT name,replace(replace(sql,'documents','content_snapshots'),'"','') AS sql FROM sqlite_schema WHERE type='trigger' AND name IN('material_identity_update','material_versions_start_draft','material_diagram_versions_insert_draft') ORDER BY name`
          )
          .filter((row) => triggers.some((trigger) => trigger.name === row.name))
      ).toStrictEqual(triggers);
      expect({
        ...connection.orm.get(
          sql`SELECT id,title,description,create_key,creation_intent FROM materials WHERE id=42`
        )
      }).toStrictEqual({
        id: 42n,
        title: 'Existing diagram',
        description: null,
        create_key: null,
        creation_intent: null
      });
      expect(connection.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      assert.throws(() =>
        connection!.orm.run(sql`UPDATE materials SET description=${'x'.repeat(241)} WHERE id=42`)
      );
      connection.exec("UPDATE materials SET create_key='receipt',creation_intent='{}' WHERE id=42");
      assert.throws(() =>
        connection!.exec(
          "INSERT INTO materials(kind,title,created_at,updated_at,create_key,creation_intent) VALUES ('diagram','Duplicate',1,1,'receipt','{}')"
        )
      );
    } finally {
      connection?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }
);
