import { testStable } from '@study/testing/vitest';
import { sql } from 'drizzle-orm';
import { assert, expect } from 'vite-plus/test';

import { createTestDatabase } from '../src/testing.ts';

testStable(
  'raw reply retirement fences publication and capture resurrection independently of learning cleanup',
  async () => {
    const location = await createTestDatabase();
    const db = await location.open();

    try {
      db.exec(`INSERT INTO notes(id,title,title_source,created_at,updated_at) VALUES(1,'Note','user',1,1);
      INSERT INTO messages(id,note_id,role,created_at) VALUES(1,1,'assistant',1),(2,1,'assistant',1),(3,1,'assistant',1);
      INSERT INTO message_versions(id,message_id,number,origin,status,text,generation_request_id,created_at)
        VALUES(1,1,1,'answer','pending','','reply-one',1),(2,2,1,'answer','complete','Preserved raw answer','reply-two',1),(3,3,1,'typed','complete','Manual',NULL,1);
      INSERT INTO note_reply_requests(request_id,note_id,version_id,snapshot) VALUES('reply-one',1,1,'{}'),('reply-two',1,2,'{}');
      INSERT INTO workflow_retired_correlations(correlation_id,event_type) VALUES('reply-one','NoteGenerationRequested'),('reply-two','NoteGenerationRequested'),('reply-three','NoteGenerationRequested');`);
      assert.throws(() =>
        db.exec("UPDATE message_versions SET status='complete',text='Late answer' WHERE id=1")
      );
      assert.throws(() =>
        db.exec(
          'UPDATE note_reply_requests SET snapshot=\'{"private":"resurrected"}\' WHERE request_id=\'reply-two\''
        )
      );
      assert.throws(() =>
        db.exec(
          "INSERT INTO note_reply_requests(request_id,note_id,version_id,snapshot) VALUES('reply-three',1,3,'{}')"
        )
      );
      assert.throws(() =>
        db.exec(
          "INSERT INTO message_versions(message_id,number,origin,status,text,generation_request_id,created_at) VALUES(3,2,'answer','complete','Bypass','reply-three',1)"
        )
      );
      db.exec(
        "INSERT INTO message_versions(message_id,number,origin,status,text,created_at) VALUES(3,2,'edited','complete','Independent manual edit',1)"
      );
      assert.strictEqual(
        db.orm.get(sql`SELECT text FROM message_versions WHERE id=2`)?.text,
        'Preserved raw answer'
      );

      for (const name of [
        'material_deletion_reply_publication',
        'history_reply_publication',
        'material_deletion_context_insert',
        'note_run_contexts_history_insert',
        'notes_history_selection'
      ])
        assert.strictEqual(
          db.orm.get(sql`SELECT 1 FROM sqlite_schema WHERE name=${name}`),
          undefined,
          name
        );

      expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      db.close();
      await location.cleanup();
    }
  }
);
