import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sql as dbSql } from 'drizzle-orm';

import { Db } from '../src/index.ts';

test('migrated pruning guards retain current roots, require exact proof and forbid body resurrection', () => {
  const db = Db.open(':memory:');
  try {
    db.exec(`INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(1,'diagram','History',1,1);
      INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(1,1,'diagram',1,1),(2,1,'diagram',2,1);
      INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(1,'mermaid','graph TD; Old'),(2,'mermaid','graph TD; Current');
      UPDATE material_versions SET status='published',published_at=2;`);
    assert.throws(() => db.exec('DELETE FROM material_diagram_versions WHERE version_id=1'));
    assert.throws(() => db.exec("UPDATE material_versions SET instruction='tampered' WHERE id=1"));
    db.exec(
      `INSERT INTO material_history_prunes(operation_id,material_id,keep_latest,token,selection,status,created_at) VALUES('prune',1,1,'${'a'.repeat(64)}','["1","2"]','pending',3);`
    );
    assert.throws(() =>
      db.exec("INSERT INTO material_history_members(version_id,operation_id) VALUES(2,'prune')")
    );
    db.exec("INSERT INTO material_history_members(version_id,operation_id) VALUES(1,'prune')");
    assert.throws(() =>
      db.exec("UPDATE material_diagram_versions SET payload='restored' WHERE version_id=1")
    );
    db.exec('DELETE FROM material_diagram_versions WHERE version_id=1');
    assert.throws(() =>
      db.exec(
        "INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(1,'mermaid','restored')"
      )
    );
    assert.throws(() => db.exec('UPDATE material_versions SET number=9 WHERE id=1'));
    assert.throws(() => db.exec('DELETE FROM material_history_members WHERE version_id=1'));
    assert.throws(() => db.exec('DELETE FROM material_diagram_versions WHERE version_id=2'));
    assert.equal(
      db.orm.get<{ n: bigint }>(
        dbSql`SELECT count(*) n FROM material_diagram_versions WHERE version_id=2`
      )?.n,
      1n
    );
  } finally {
    db.close();
  }
});
