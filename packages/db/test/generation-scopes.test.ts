import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTestDatabase } from '../src/testing.ts';

test('generation scope closure and identity survive direct writes and allow project cascades', () => {
  const location = createTestDatabase();
  const db = location.open();

  try {
    db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'One',1,1),(2,'Two',1,1);
      INSERT INTO material_generation_scopes(id,project_id,enabled,created_at,updated_at) VALUES('scope',1,1,1,1);
      UPDATE material_generation_scopes SET enabled=0,updated_at=2 WHERE id='scope';`);

    for (const mutation of [
      "UPDATE material_generation_scopes SET enabled=1 WHERE id='scope'",
      "UPDATE material_generation_scopes SET id='replacement' WHERE id='scope'",
      "UPDATE material_generation_scopes SET project_id=2 WHERE id='scope'",
      "UPDATE material_generation_scopes SET created_at=0 WHERE id='scope'",
      "DELETE FROM material_generation_scopes WHERE id='scope'"
    ])
      assert.throws(() => db.exec(mutation));

    db.exec('DELETE FROM projects WHERE id=1');
    assert.equal(db.orm.get('SELECT * FROM material_generation_scopes'), undefined);
    assert.deepEqual(db.orm.all('PRAGMA foreign_key_check'), []);
  } finally {
    db.close();
    location.cleanup();
  }
});

test('scoped generation requests require a live scope in their own project', () => {
  const location = createTestDatabase();
  const db = location.open();

  try {
    db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'One',1,1),(2,'Two',1,1);
      INSERT INTO material_generation_scopes(id,project_id,enabled,created_at,updated_at) VALUES('scope',1,1,1,1),('closed',1,0,1,1);`);
    db.exec(`INSERT INTO material_generation_requests(id,project_id,payload,created_at)
      VALUES('valid',1,'{"title":"Question","kind":"quiz","inputVersionIds":["1"],"scopeId":"scope"}',1),
      ('unscoped',1,'{"title":"Question","kind":"quiz","inputVersionIds":["1"],"scopeId":null}',1)`);
    assert.throws(() =>
      db.exec(`INSERT INTO material_generation_requests(id,project_id,payload,created_at)
      VALUES('invalid-spec',1,'{"title":"Question","kind":"quiz","inputVersionIds":["1"],"questionSpec":{"count":2,"kind":"open"}}',1)`)
    );

    for (const scopeId of ['missing', 'closed'])
      assert.throws(() =>
        db.exec(`
      INSERT INTO material_generation_requests(id,project_id,payload,created_at)
      VALUES('request',1,'{"title":"Question","kind":"quiz","inputVersionIds":["1"],"scopeId":"${scopeId}"}',1)`)
      );

    assert.throws(() =>
      db.exec(`INSERT INTO material_generation_requests(id,project_id,payload,created_at)
      VALUES('other-project',2,'{"title":"Question","kind":"quiz","inputVersionIds":["1"],"scopeId":"scope"}',1)`)
    );
  } finally {
    db.close();
    location.cleanup();
  }
});
