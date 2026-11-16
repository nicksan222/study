import { BunFileSystem } from '@effect/platform-bun';
import { test } from '@study/testing';
import { Effect, FileSystem } from 'effect';

import { sql } from '../src/index.ts';
import { workflow_agent_progress } from '../src/schema.ts';

test.stable(
  'upgrading existing agent previews defaults their phase without losing progress',
  async ({ databases }) => {
    const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));
    const folder = await test.temporaryDirectory({ prefix: 'study-progress-upgrade-' });
    const older = `${folder.path}/drizzle`;

    await Effect.runPromise(
      fs.copy(Bun.fileURLToPath(new URL('../drizzle', import.meta.url)), older)
    );

    for (const entry of await Effect.runPromise(fs.readDirectory(older))) {
      if (/^\d{14}_/.test(entry) && entry >= '20261115231803_agent-progress-phase')
        await Effect.runPromise(fs.remove(older + '/' + entry, { recursive: true }));
    }

    const location = await databases(older);
    let db = await location.open();

    try {
      db.exec(`INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,status,created_at,updated_at)
      VALUES('run','test',1,'{}','running',1,1);
      INSERT INTO workflow_agent_progress(run_id,execution_id,activity_name,attempt,agent_id,mode,status,text,revision,updated_at)
      VALUES('agent','run','reply',1,'reply','text','running','Retained preview',2,1);`);
      db.close();
      db = await location.open({ migrations: 'current' });
      test.expect(db.orm.select().from(workflow_agent_progress).get()).toMatchObject({
        run_id: 'agent',
        phase: 'generating',
        text: 'Retained preview',
        revision: 2n,
        status: 'running'
      });
      test.expect(() => db.exec("UPDATE workflow_agent_progress SET phase='unknown'")).toThrow();
      test.expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    } finally {
      db.close();
    }
  }
);
