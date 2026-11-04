import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { replySnapshotSchema } from '@study/contracts/conversations/schemas';
import { testMigration } from '@study/testing/node';
import { sql } from 'drizzle-orm';
import { Schema } from 'effect';

import { Db } from '../src/index.ts';
import { requireRow } from './rows.ts';

testMigration({ migration: 'document_domains_cutover', retention: 'permanent' })(
  'reply upgrade pins exact ready and pending source revisions and retires ambiguous captures without losing completed messages',
  () => {
    const folder = mkdtempSync(join(tmpdir(), 'study-reply-sources-'));
    const official = fileURLToPath(new URL('../drizzle', import.meta.url));
    const migrations =
      process.env.STUDY_FINAL_MIGRATIONS ?? process.env.STUDY_REPLY_MIGRATIONS ?? official;
    const before = join(folder, 'before');

    mkdirSync(before);
    let db: Db | undefined;

    try {
      for (const name of readdirSync(official))
        if (name < '20261104014018')
          cpSync(join(official, name), join(before, name), { recursive: true });

      const path = join(folder, 'study.db');

      db = Db.open(path, before);
      db.exec(`INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(1,'Session','user',1,1);
      INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES(1,'import','text','text/plain','Input',1,zeroblob(32),1);
      INSERT INTO source_snapshots(source_id,revision,bytes) VALUES(1,1,x'61'),(1,2,x'62'),(1,3,x'63');
      INSERT INTO content_snapshots(id,source_id,extractor_version,meta,created_at) VALUES(1,1,0,'{}',1),(2,1,0,'{}',1);
      INSERT INTO source_extraction_revisions(source_id,revision,snapshot_id) VALUES(1,1,1),(1,2,2),(1,3,2);`);

      for (const [id, requestId, attachments, pendingAttachments] of [
        [
          1,
          'ready',
          [{ partId: '11', sourceId: '1', documentId: '1', sourceName: 'Input', projectId: null }],
          null
        ],
        [
          2,
          'pending',
          [],
          [
            {
              messageId: '2',
              partId: '12',
              sourceId: '1',
              inputRevision: '2',
              sourceName: 'Input',
              projectId: null,
              requestId: 'source-2'
            }
          ]
        ],
        [
          3,
          'ambiguous',
          [{ partId: '13', sourceId: '1', documentId: '2', sourceName: 'Input', projectId: null }],
          null
        ]
      ] as const) {
        const capture = JSON.stringify({
          requestId,
          sessionId: '1',
          messageId: String(id),
          versionId: String(id),
          contextRevision: '0',
          messages: [
            {
              messageId: String(id),
              versionId: String(id),
              role: 'user',
              text: 'Input',
              attachments
            }
          ],
          pendingAttachments
        });

        db.exec(`INSERT INTO messages(id,session_id,role,created_at) VALUES(${id},1,'assistant',1);
        INSERT INTO message_versions(id,message_id,number,origin,status,text,created_at) VALUES(${id},${id},1,'answer','complete','Completed answer',1);
        UPDATE messages SET active_version_id=${id} WHERE id=${id};`);
        db.orm.run(
          sql`INSERT INTO conversation_reply_requests(request_id,session_id,version_id,snapshot) VALUES(${requestId},1,${id},${capture})`
        );
        const intent = { sessionId: '1', intentKey: requestId, instruction: '', preferences: {} };
        const context = JSON.stringify({
          ...intent,
          requestId,
          selectionRevision: '0',
          inputs: [],
          messages: [],
          excludedMessages: 0
        });

        db.orm.run(
          sql`INSERT INTO session_run_contexts(request_id,session_id,intent_key,intent,snapshot) VALUES(${requestId},1,${requestId},${JSON.stringify(intent)},${context})`
        );
      }

      db.exec(`INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,status,owner_token,created_at,updated_at)
      VALUES('retire','ConversationReplyWorkflow',1,'{"event":{"type":"ConversationGenerationRequested","correlationId":"ambiguous"},"private":"body"}','running','owner',1,1);
      INSERT INTO workflow_activities(execution_id,name,attempt,result) VALUES('retire','capture',0,'{"private":"body"}');`);
      db.close();
      db = Db.open(path, migrations);
      assert.deepEqual(
        db.orm
          .all(
            sql`SELECT request_id,part_id,revision,snapshot_id FROM conversation_reply_sources ORDER BY request_id`
          )
          .map((row) => ({ ...row })),
        [
          { request_id: 'pending', part_id: 12n, revision: 2n, snapshot_id: null },
          { request_id: 'ready', part_id: 11n, revision: 1n, snapshot_id: 1n }
        ]
      );
      const ready = JSON.parse(
        String(
          requireRow(
            db.orm.get(
              sql`SELECT snapshot FROM conversation_reply_requests WHERE request_id='ready'`
            )
          ).snapshot
        )
      );

      assert.deepEqual(ready.messages[0].attachments[0], {
        partId: '11',
        sourceId: '1',
        sourceName: 'Input',
        projectId: null,
        revision: '1',
        snapshotId: '1'
      });
      Schema.decodeUnknownSync(Schema.fromJsonString(Schema.toCodecJson(replySnapshotSchema)))(
        JSON.stringify(ready)
      );
      assert.equal(
        requireRow(db.orm.get(sql`SELECT text FROM message_versions WHERE id=3`)).text,
        'Completed answer'
      );
      assert.equal(
        requireRow(db.orm.get(sql`SELECT generation_request_id FROM message_versions WHERE id=3`))
          .generation_request_id,
        'ambiguous'
      );
      assert.equal(
        db.orm.get(sql`SELECT 1 FROM conversation_reply_requests WHERE request_id='ambiguous'`),
        undefined
      );
      assert.equal(
        db.orm.get(sql`SELECT 1 FROM session_run_contexts WHERE request_id='ambiguous'`),
        undefined
      );
      assert.equal(
        requireRow(
          db.orm.get(
            sql`SELECT request_id FROM session_retired_intents WHERE request_id='ambiguous'`
          )
        ).request_id,
        'ambiguous'
      );
      assert.deepEqual(
        {
          ...db.orm.get(
            sql`SELECT status,payload,owner_token FROM workflow_executions WHERE execution_id='retire'`
          )
        },
        { status: 'cancelled', payload: '{}', owner_token: null }
      );
      assert.equal(
        db.orm.get(sql`SELECT 1 FROM workflow_activities WHERE execution_id='retire'`),
        undefined
      );
      assert.throws(() =>
        db!.exec('DELETE FROM source_snapshots WHERE source_id=1 AND revision=2')
      );
      assert.throws(() =>
        db!.exec("DELETE FROM conversation_reply_sources WHERE request_id='ready'")
      );
      assert.throws(() =>
        db!.exec("UPDATE conversation_reply_sources SET revision=3 WHERE request_id='pending'")
      );
      db.exec('DELETE FROM sessions WHERE id=1');
      assert.equal(
        requireRow(db.orm.get(sql`SELECT count(*) AS n FROM conversation_reply_sources`)).n,
        0n
      );
      assert.deepEqual(db.orm.all(sql`PRAGMA foreign_key_check`), []);
      const identity = db.schemaIdentity();

      db.close();
      db = Db.open(path, migrations);
      assert.equal(db.schemaIdentity(), identity);
      assert.deepEqual(db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      db?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }
);

testMigration({ migration: 'document_domains_cutover', retention: 'permanent' })(
  'exact reply-source migration initializes a fresh database',
  () => {
    const migrations =
      process.env.STUDY_REPLY_MIGRATIONS ?? fileURLToPath(new URL('../drizzle', import.meta.url));
    const db = Db.open(':memory:', migrations);

    try {
      assert.deepEqual(db.orm.all(sql`PRAGMA foreign_key_check`), []);
      assert.ok(
        db.orm.get(sql`SELECT 1 FROM sqlite_schema WHERE name='conversation_reply_sources_capture'`)
      );
    } finally {
      db.close();
    }
  }
);
