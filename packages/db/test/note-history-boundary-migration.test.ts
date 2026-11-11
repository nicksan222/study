import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { replySnapshotSchema } from '@study/contracts/notes/schemas';
import { testStable } from '@study/testing/vitest';
import { Effect, FileSystem, Path, Schema } from 'effect';
import { expect } from 'vite-plus/test';

import { Db, sql } from '../src/index.ts';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

const { join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

testStable(
  'upgrading pending replies repairs historical boundary reasons in durable copies',
  async () => {
    const folder = await Effect.runPromise(
      fs.makeTempDirectory({ prefix: 'study-note-boundary-' })
    );
    const previous = join(folder, 'previous');
    const path = join(folder, 'study.sqlite');
    const migrations = Bun.fileURLToPath(new URL('../drizzle', import.meta.url));
    let db: Db | undefined;

    try {
      for (const name of await Effect.runPromise(fs.readDirectory(migrations)))
        if (name <= '20261108023348_notes-pages')
          await Effect.runPromise(fs.copy(join(migrations, name), join(previous, name)));

      db = await Db.open(path, previous);
      const historical = {
        requestId: 'reply',
        noteId: '1',
        messageId: '1',
        versionId: '1',
        contextRevision: '0',
        historyBoundary: {
          includedMessages: 1,
          excludedMessages: 2,
          reason: 'conversation-boundary'
        },
        messages: []
      };
      const snapshot = {
        ...historical,
        text: 'conversation-boundary',
        meta: { captured: historical },
        metadata: { captured: historical },
        document: { blocks: [], ...historical }
      };
      const encoded = JSON.stringify(snapshot);
      const wrapped = JSON.stringify({ _tag: 'Success', value: snapshot });

      db.exec(`INSERT INTO notes(id,title,title_source,created_at,updated_at) VALUES(1,'Lecture','user',1,1);
      INSERT INTO messages(id,note_id,role,created_at) VALUES(1,1,'assistant',1);
      INSERT INTO message_versions(id,message_id,number,origin,status,created_at) VALUES(1,1,1,'answer','pending',1);`);
      db.orm.run(
        sql`INSERT INTO note_reply_requests(request_id,note_id,version_id,snapshot) VALUES('reply',1,1,${encoded})`
      );
      db.orm.run(
        sql`INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,result,status,created_at,updated_at) VALUES('reply-execution','conversation-reply/v1',1,${wrapped},${wrapped},'suspended',1,1)`
      );
      db.orm.run(
        sql`INSERT INTO workflow_activities(execution_id,name,attempt,result) VALUES('reply-execution','captured-reply',0,${wrapped})`
      );
      db.orm.run(
        sql`INSERT INTO workflow_deferreds(execution_id,name,result) VALUES('reply-execution','reply',${wrapped})`
      );
      db.close();
      db = await Db.open(path);
      const captured = JSON.parse(
        String(db.orm.get(sql`SELECT snapshot FROM note_reply_requests`)!.snapshot)
      );
      const expected = {
        ...snapshot,
        historyBoundary: { ...snapshot.historyBoundary, reason: 'note-boundary' }
      };

      expect(captured).toStrictEqual(expected);
      expect(
        Schema.decodeUnknownSync(Schema.toCodecJson(replySnapshotSchema))(captured).historyBoundary
          ?.reason
      ).toBe('note-boundary');

      for (const statement of [
        'SELECT payload AS value FROM workflow_executions',
        'SELECT result AS value FROM workflow_executions',
        'SELECT result AS value FROM workflow_activities',
        'SELECT result AS value FROM workflow_deferreds'
      ]) {
        const copy = JSON.parse(String(db.orm.get(sql.raw(statement))!.value));

        expect(copy).toStrictEqual({ _tag: 'Success', value: expected });
      }

      expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      db.close();
      db = await Db.open(path);
      expect(
        JSON.parse(String(db.orm.get(sql`SELECT snapshot FROM note_reply_requests`)!.snapshot))
      ).toStrictEqual(expected);
    } finally {
      db?.close();
      await Effect.runPromise(fs.remove(folder, { recursive: true, force: true }));
    }
  }
);
