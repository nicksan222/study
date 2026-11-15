import { BunFileSystem } from '@effect/platform-bun';
import { testStable } from '@study/testing/vitest';
import { Effect, FileSystem } from 'effect';
import { expect } from 'vite-plus/test';

import { Db, sql } from '../src/index.ts';
import { workflow_agent_progress } from '../src/schema.ts';
import { createTestDatabase } from '../src/testing.ts';

testStable(
  'upgrading existing agent previews defaults their phase without losing progress',
  async () => {
    const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));
    const folder = await Effect.runPromise(
      fs.makeTempDirectory({ prefix: 'study-progress-upgrade-' })
    );
    const older = folder + '/drizzle';

    await Effect.runPromise(
      fs.copy(Bun.fileURLToPath(new URL('../drizzle', import.meta.url)), older)
    );

    for (const entry of await Effect.runPromise(fs.readDirectory(older))) {
      if (/^\d{14}_/.test(entry) && entry >= '20261115231803_agent-progress-phase')
        await Effect.runPromise(fs.remove(older + '/' + entry, { recursive: true }));
    }

    const location = await createTestDatabase(older);
    let db = await location.open();

    try {
      db.exec(`INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,status,created_at,updated_at)
      VALUES('run','test',1,'{}','running',1,1);
      INSERT INTO workflow_agent_progress(run_id,execution_id,activity_name,attempt,agent_id,mode,status,text,revision,updated_at)
      VALUES('agent','run','reply',1,'reply','text','running','Retained preview',2,1);`);
      const path = db.path;

      db.close();
      db = await Db.open(path);
      expect(db.orm.select().from(workflow_agent_progress).get()).toMatchObject({
        run_id: 'agent',
        phase: 'generating',
        text: 'Retained preview',
        revision: 2n,
        status: 'running'
      });
      expect(() => db.exec("UPDATE workflow_agent_progress SET phase='unknown'")).toThrow();
      expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    } finally {
      db.close();
      await location.cleanup();
      await Effect.runPromise(fs.remove(folder, { recursive: true }));
    }
  }
);
