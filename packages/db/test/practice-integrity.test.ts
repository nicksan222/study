import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTestDatabase } from '../src/testing.ts';

test('practice keeps bounded immutable slots and durable control epochs', () => {
  const location = createTestDatabase();
  const db = location.open();

  try {
    db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'One',1,1);
      INSERT INTO materials(id,project_id,kind,title,created_at,updated_at) VALUES(1,1,'document','Input',1,1);
      INSERT INTO material_versions(id,material_id,project_id,kind,number,created_at) VALUES(1,1,1,'document',1,1);
      INSERT INTO documents(id,extractor_version,meta,created_at) VALUES(1,1,'{"extractor":null,"extractorVersion":1,"provider":null,"durationMs":null,"pageCount":null,"refiners":[],"waitingFor":[],"corrected":false}',1);
      INSERT INTO blocks(document_id,ordinal,kind,text,anchor) VALUES(1,0,'paragraph','Evidence','{"type":"page","page":1}');
      INSERT INTO material_document_versions(version_id,document_id) VALUES(1,1);
      UPDATE material_versions SET status='published',published_at=2 WHERE id=1;
      INSERT INTO learning_practice_controls(project_id,epoch,enabled) VALUES(1,'epoch',1);
      INSERT INTO learning_practice_slots(id,project_id,epoch,ordinal,kind,status,input_version_ids)
      VALUES('slot-0',1,'epoch',0,'choice','pending','["1"]'),('slot-1',1,'epoch',1,'choice','pending','["1"]');`);
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
      db.exec(`INSERT INTO learning_practice_slots(id,project_id,epoch,ordinal,kind,status,input_version_ids)
      VALUES('slot-2',1,'epoch',2,'open','pending','["1"]')`)
    );
    assert.throws(() =>
      db.exec("UPDATE learning_practice_slots SET input_version_ids='[]' WHERE id='slot-0'")
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
    assert.deepEqual(db.orm.all('PRAGMA foreign_key_check'), []);
  } finally {
    db.close();
    location.cleanup();
  }
});
