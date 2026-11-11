import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { createTestDatabase } from '../src/testing.ts';

testStable('practice keeps bounded immutable slots and durable control epochs', async () => {
  const location = await createTestDatabase();
  const db = await location.open();

  try {
    db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'One',1,1);
      INSERT INTO pages(id,title,created_at,updated_at) VALUES(1,'Input',1,1);
      INSERT INTO content_snapshots(id,extractor_version,meta,created_at) VALUES(1,1,'{"extractor":null,"extractorVersion":1,"provider":null,"durationMs":null,"pageCount":null,"refiners":[],"waitingFor":[],"corrected":false}',1);
      INSERT INTO blocks(document_id,ordinal,kind,text,anchor,editing_id,content) VALUES(1,0,'paragraph','Evidence','{"type":"authored"}',lower(hex(randomblob(16))),json_object('type','paragraph','inlines',json_array(json_object('type','text','text','Evidence','marks',json_array()))));
      INSERT INTO page_versions(id,page_id,number,content_snapshot_id,created_at) VALUES(1,1,1,1,1);
      UPDATE page_versions SET status='published',published_at=2 WHERE id=1;
      INSERT INTO project_pages(project_id,page_id) VALUES(1,1);
      INSERT INTO learning_practice_controls(project_id,epoch,enabled) VALUES(1,'epoch',1);
      INSERT INTO learning_practice_slots(id,project_id,epoch,ordinal,kind,status,inputs)
      VALUES('slot-0',1,'epoch',0,'choice','pending','[{"kind":"page","versionId":"1"}]'),('slot-1',1,'epoch',1,'choice','pending','[{"kind":"page","versionId":"1"}]');
      INSERT INTO learning_practice_inputs(slot_id,position,page_version_id) VALUES('slot-0',0,1),('slot-1',0,1);`);
    assert.throws(() =>
      db.exec("UPDATE learning_practice_slots SET generation_attempt=-1 WHERE id='slot-0'")
    );
    assert.throws(() =>
      db.exec("UPDATE learning_practice_slots SET generation_attempt=1 WHERE id='slot-0'")
    );
    db.exec("UPDATE learning_practice_slots SET failure_kind='unsupported' WHERE id='slot-0'");
    db.exec(
      "UPDATE learning_practice_slots SET generation_attempt=1,failure_kind=NULL WHERE id='slot-0'"
    );
    assert.throws(() =>
      db.exec("UPDATE learning_practice_slots SET generation_attempt=0 WHERE id='slot-0'")
    );
    assert.throws(() =>
      db.exec(`INSERT INTO learning_practice_slots(id,project_id,epoch,ordinal,kind,status,inputs)
      VALUES('slot-2',1,'epoch',2,'open','pending','[{"kind":"page","versionId":"1"}]')`)
    );
    assert.throws(() =>
      db.exec("UPDATE learning_practice_slots SET inputs='[]' WHERE id='slot-0'")
    );
    assert.throws(() =>
      db.exec("UPDATE learning_practice_slots SET status='answered' WHERE id='slot-0'")
    );
    assert.throws(() => db.exec("DELETE FROM learning_practice_slots WHERE id='slot-0'"));
    assert.throws(() =>
      db.exec("UPDATE learning_practice_controls SET epoch='changed' WHERE project_id=1")
    );
    db.exec('UPDATE learning_practice_controls SET enabled=0 WHERE project_id=1');
    assert.throws(() =>
      db.exec('UPDATE learning_practice_controls SET enabled=1 WHERE project_id=1')
    );
    db.exec("UPDATE learning_practice_slots SET status='cancelled' WHERE project_id=1");
    assert.throws(() =>
      db.exec("UPDATE learning_practice_slots SET status='pending' WHERE id='slot-0'")
    );
    db.exec('DELETE FROM projects WHERE id=1');
    expect(db.orm.all('PRAGMA foreign_key_check')).toStrictEqual([]);
  } finally {
    db.close();
    await location.cleanup();
  }
});
