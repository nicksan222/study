import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { Db, sql } from '../src/index.ts';

testStable(
  'semantic search retirement removes indexing journals and preserves other work',
  async () => {
    const folder = mkdtempSync(join(tmpdir(), 'study-retire-search-'));
    const previous = join(folder, 'previous');
    const path = join(folder, 'study.sqlite');
    const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
    let db: Db | undefined;

    try {
      for (const name of readdirSync(migrations))
        if (name < '20261111144440_right_malcolm_colcord')
          cpSync(join(migrations, name), join(previous, name), { recursive: true });

      db = await Db.open(path, previous);
      db.exec(`INSERT INTO notes(id,title,title_source,created_at,updated_at) VALUES(1,'Keep note','user',1,1);
      INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,status,parent_execution_id,created_at,updated_at)
      VALUES('search','search-reconciliation/v1',1,'{}','suspended',NULL,1,1),('child','nested/v1',1,'{}','suspended','search',1,1),('keep','notes/v1',1,'{}','suspended',NULL,1,1);
      INSERT INTO workflow_activities(execution_id,name,attempt,result) VALUES('search','index',0,'{}'),('child','nested',0,'{}'),('keep','keep',0,'{}');
      INSERT INTO workflow_deferreds(execution_id,name,result) VALUES('search','wait','{}');
      INSERT INTO workflow_clocks(execution_id,name,deferred_name,due_at) VALUES('search','retry','wait',1);
      INSERT INTO workflow_configuration_waits(execution_id,deferred_name,observed_revision,reason) VALUES('search','wait','0','auth');`);
      db.close();
      db = undefined;
      db = await Db.open(path);
      expect(db.orm.all(sql`SELECT execution_id FROM workflow_executions`)).toStrictEqual([
        { execution_id: 'keep' }
      ]);
      expect(db.orm.all(sql`SELECT execution_id FROM workflow_activities`)).toStrictEqual([
        { execution_id: 'keep' }
      ]);
      expect(
        db.orm.all(sql`SELECT name FROM sqlite_schema WHERE name='semantic_search_entries'`)
      ).toStrictEqual([]);
      expect(db.orm.all(sql`SELECT title FROM notes`)).toStrictEqual([{ title: 'Keep note' }]);
      expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      db.close();
      db = undefined;
      db = await Db.open(path);
      expect(db.orm.all(sql`SELECT execution_id FROM workflow_executions`)).toStrictEqual([
        { execution_id: 'keep' }
      ]);
    } finally {
      db?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }
);
