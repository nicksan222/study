import { testStable } from '@study/testing/vitest';
import { sql } from 'drizzle-orm';
import { assert, expect } from 'vite-plus/test';

import { createTestDatabase } from '../src/testing.ts';

function assertThrowsMatching(run: () => unknown, matches: (error: unknown) => boolean) {
  try {
    run();
  } catch (error) {
    assert.ok(matches(error), 'Thrown error did not match');

    return;
  }

  assert.fail('Expected function to throw');
}

const seed = `INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Project',1,1);
 INSERT INTO pages(id,title,created_at,updated_at) VALUES(1,'Input',1,1);
 INSERT INTO content_snapshots(id,extractor_version,meta,created_at) VALUES(1,1,'{}',1),(2,1,'{}',1);
 INSERT INTO blocks(document_id,ordinal,kind,text,anchor,editing_id,content)
 SELECT id,0,'paragraph','Evidence','{"type":"authored"}','input-'||id,'{"type":"paragraph","inlines":[{"type":"text","text":"Evidence","marks":[]}]}' FROM content_snapshots;
 INSERT INTO page_versions(id,page_id,number,content_snapshot_id,created_at) VALUES(1,1,1,1,1),(3,1,2,2,1);
 UPDATE page_versions SET status='published',published_at=2;
 INSERT INTO project_pages(project_id,page_id) VALUES(1,1);
 INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(2,'flashcards','Requested',1,1);
 INSERT INTO project_materials(project_id,material_id) VALUES(1,2);
 INSERT INTO material_generation_requests(id,project_id,payload,created_at) VALUES('request',1,'{"title":"Requested","kind":"flashcards","inputs":[{"kind":"page","versionId":"1"}]}',1);
 INSERT INTO material_evidence_inputs(request_id,position,page_version_id) VALUES('request',0,1);
 INSERT INTO material_versions(id,material_id,kind,number,creator,operation,created_at) VALUES(2,2,'flashcards',1,'agent','generate',1);
 INSERT INTO material_flashcard_versions(version_id,material_id) SELECT id,material_id FROM material_versions v WHERE id IN (2) AND NOT EXISTS(SELECT 1 FROM material_flashcard_versions f WHERE f.version_id=v.id); INSERT INTO material_card_identities(id,material_id) SELECT DISTINCT material_id,material_id FROM material_versions v WHERE id IN (2) AND NOT EXISTS(SELECT 1 FROM material_card_identities c WHERE c.id=v.material_id); INSERT INTO material_flashcard_entries(version_id,material_id,card_id,position,front,back) SELECT id,material_id,material_id,0,'flowchart TD; A-->B','Answer' FROM material_versions WHERE id=2;`;

async function fixture(scoped = false, autoTitle = false) {
  const location = await createTestDatabase();
  const db = await location.open();
  const intent = autoTitle
    ? seed.replace('"title":"Requested",', '"title":"Requested","autoTitle":true,')
    : seed;

  db.exec(
    scoped
      ? intent
          .replace(
            'INSERT INTO materials',
            "INSERT INTO material_generation_scopes(id,project_id,enabled,created_at,updated_at) VALUES('scope',1,1,1,1); INSERT INTO materials"
          )
          .replace(
            '"title":"Requested","kind":"flashcards","inputs"',
            '"title":"Requested","kind":"flashcards","scopeId":"scope","inputs"'
          )
      : intent
  );

  return {
    db,
    close: async () => {
      db.close();
      await location.cleanup();
    }
  };
}

testStable(
  'automatic titles permit bounded generated names while ordinary requests keep exact title intent',
  async () => {
    for (const autoTitle of [false, true]) {
      const { db, close } = await fixture(false, autoTitle);

      try {
        db.exec(`INSERT INTO material_evidence_inputs(version_id,page_version_id,position) VALUES(2,1,0);
      UPDATE material_versions SET generation_request_id='request' WHERE id=2;
      UPDATE materials SET title='Evidence relationships' WHERE id=2;`);
        const publish = () =>
          db.exec(`UPDATE material_versions SET status='published',published_at=2 WHERE id=2;
      UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='request';`);

        if (autoTitle) assert.doesNotThrow(publish);
        else assert.throws(publish);
      } finally {
        await close();
      }
    }
  }
);

testStable(
  'automatic titles reject unbounded or blank names and malformed title intent',
  async () => {
    const { db, close } = await fixture(false, true);

    try {
      db.exec(`INSERT INTO material_evidence_inputs(version_id,page_version_id,position) VALUES(2,1,0);
    UPDATE material_versions SET generation_request_id='request' WHERE id=2;`);

      for (const title of ['', ' ', ' Evidence ', 'x'.repeat(201)]) {
        assert.throws(() => {
          db.orm.run(sql`UPDATE materials SET title=${title} WHERE id=2`);
          db.exec(`UPDATE material_versions SET status='published',published_at=2 WHERE id=2`);
        });
      }

      assert.throws(() =>
        db.exec(
          `INSERT INTO material_generation_requests(id,project_id,payload,created_at) VALUES('invalid-auto',1,'{"title":"Requested","autoTitle":1,"kind":"diagram","inputs":[{"kind":"page","versionId":"1"}]}',1)`
        )
      );
    } finally {
      await close();
    }
  }
);

testStable('a receipt cannot select an unrelated draft', async () => {
  const { db, close } = await fixture();

  try {
    assert.throws(() =>
      db.exec(
        `UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='request'`
      )
    );
  } finally {
    await close();
  }
});

testStable(
  'captured generation intent and ordered inputs cannot be rewritten or deleted',
  async () => {
    const { db, close } = await fixture();

    try {
      assert.throws(() =>
        db.exec(
          `UPDATE material_generation_requests SET payload=json_set(payload,'$.title','Changed') WHERE id='request'`
        )
      );
      assert.throws(() =>
        db.exec(`UPDATE material_evidence_inputs SET page_version_id=3 WHERE request_id='request'`)
      );
      assert.throws(() =>
        db.exec(`DELETE FROM material_evidence_inputs WHERE request_id='request'`)
      );
      assert.throws(() =>
        db.exec(
          `INSERT INTO material_evidence_inputs(request_id,page_version_id,position) VALUES('request',3,1)`
        )
      );
      assert.throws(() => db.exec(`DELETE FROM material_generation_requests WHERE id='request'`));
      assert.doesNotThrow(() => db.exec('DELETE FROM projects WHERE id=1'));
    } finally {
      await close();
    }
  }
);

testStable(
  'a completed receipt stays bound to its published output and permits project deletion',
  async () => {
    const { db, close } = await fixture();

    try {
      db.exec(`INSERT INTO material_evidence_inputs(version_id,page_version_id,position) VALUES(2,1,0);
      UPDATE material_versions SET generation_request_id='request' WHERE id=2;
      UPDATE material_versions SET status='published',published_at=2 WHERE id=2;
      UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='request';`);
      assert.throws(() => db.exec(`DELETE FROM material_generation_requests WHERE id='request'`));
      assert.throws(() =>
        db.exec(`UPDATE material_generation_requests SET result_version_id=1 WHERE id='request'`)
      );
      assert.throws(() =>
        db.exec(`INSERT INTO material_generation_requests(id,project_id,payload,created_at) VALUES('other',1,'{"title":"Requested","kind":"flashcards","inputs":["1"]}',1);
      UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='other'`)
      );
      assert.doesNotThrow(() => db.exec('DELETE FROM projects WHERE id=1'));
    } finally {
      await close();
    }
  }
);

testStable('closed scopes fence direct publication of a valid generated draft', async () => {
  const { db, close } = await fixture(true);

  try {
    db.exec(`INSERT INTO material_evidence_inputs(version_id,page_version_id,position) VALUES(2,1,0);
      UPDATE material_versions SET generation_request_id='request' WHERE id=2;
      UPDATE material_generation_scopes SET enabled=0,updated_at=2 WHERE id='scope';`);
    assert.throws(
      () => db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=2"),
      /scope is not active/
    );
    assert.doesNotThrow(() => db.exec('DELETE FROM projects WHERE id=1'));
  } finally {
    await close();
  }
});

testStable(
  'generation publication rejects a captured input removed from its collection',
  async () => {
    const { db, close } = await fixture();

    try {
      db.exec(
        "INSERT INTO material_evidence_inputs(version_id,page_version_id,position) VALUES(2,1,0); UPDATE material_versions SET generation_request_id='request' WHERE id=2; DELETE FROM project_pages WHERE page_id=1;"
      );
      assert.throws(() =>
        db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=2")
      );
    } finally {
      await close();
    }
  }
);

testStable(
  'the first generation receipt rejects an input removed after output publication',
  async () => {
    const { db, close } = await fixture();

    try {
      db.exec(
        "INSERT INTO material_evidence_inputs(version_id,page_version_id,position) VALUES(2,1,0); UPDATE material_versions SET generation_request_id='request' WHERE id=2; UPDATE material_versions SET status='published',published_at=2 WHERE id=2; DELETE FROM project_pages WHERE page_id=1;"
      );
      assert.throws(() =>
        db.exec(
          "UPDATE material_generation_requests SET result_version_id=2,result_hash='" +
            '0'.repeat(64) +
            "' WHERE id='request'"
        )
      );
    } finally {
      await close();
    }
  }
);

testStable(
  'a committed generation receipt remains stable after its input leaves the collection',
  async () => {
    const { db, close } = await fixture();

    try {
      db.exec(
        "INSERT INTO material_evidence_inputs(version_id,page_version_id,position) VALUES(2,1,0); UPDATE material_versions SET generation_request_id='request' WHERE id=2; UPDATE material_versions SET status='published',published_at=2 WHERE id=2; UPDATE material_generation_requests SET result_version_id=2,result_hash='" +
          '0'.repeat(64) +
          "' WHERE id='request'; DELETE FROM project_pages WHERE page_id=1;"
      );
      assert.doesNotThrow(() =>
        db.exec(
          "UPDATE material_generation_requests SET result_version_id=2,result_hash='" +
            '0'.repeat(64) +
            "' WHERE id='request'"
        )
      );
      assert.throws(() =>
        db.exec(
          "UPDATE material_generation_requests SET result_hash='" +
            '1'.repeat(64) +
            "' WHERE id='request'"
        )
      );
    } finally {
      await close();
    }
  }
);

for (const stage of ['publication', 'receipt']) {
  testStable(
    `every captured input needs membership at first ${stage}, even when shared elsewhere`,
    async () => {
      const { db, close } = await fixture();

      try {
        db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES(2,'Elsewhere',1,1);
        INSERT INTO pages(id,title,created_at,updated_at) VALUES(3,'Second input',1,1);
        INSERT INTO content_snapshots(id,extractor_version,meta,created_at) SELECT 3,extractor_version,meta,created_at FROM content_snapshots WHERE id=1;
        INSERT INTO blocks(document_id,ordinal,kind,text,anchor,editing_id,content) SELECT 3,ordinal,kind,text,anchor,editing_id,content FROM blocks WHERE document_id=1;
        INSERT INTO page_versions(id,page_id,number,content_snapshot_id,created_at) VALUES(4,3,1,3,1);
        UPDATE page_versions SET status='published',published_at=2 WHERE id=4;
        INSERT INTO project_pages(project_id,page_id) VALUES(1,3),(2,3);
        INSERT INTO material_generation_requests(id,project_id,payload,created_at)
          VALUES('multiple',1,'{"title":"Requested","kind":"flashcards","inputs":[{"kind":"page","versionId":"1"},{"kind":"page","versionId":"4"}]}',1);
        INSERT INTO material_evidence_inputs(request_id,page_version_id,position) VALUES('multiple',1,0),('multiple',4,1);
        INSERT INTO material_evidence_inputs(version_id,page_version_id,position) VALUES(2,1,0),(2,4,1);
        UPDATE material_versions SET generation_request_id='multiple' WHERE id=2;`);

        if (stage === 'receipt')
          db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=2");

        db.exec('DELETE FROM project_pages WHERE project_id=1 AND page_id=3');
        const write =
          stage === 'publication'
            ? "UPDATE material_versions SET status='published',published_at=2 WHERE id=2"
            : `UPDATE material_generation_requests SET result_version_id=2,result_hash='${'0'.repeat(64)}' WHERE id='multiple'`;

        assertThrowsMatching(
          () => db.exec(write),
          (error: unknown) => error instanceof Error && 'errno' in error && error.errno === 1811
        );
        assert.strictEqual(
          db.orm.get(
            "SELECT result_version_id FROM material_generation_requests WHERE id='multiple'"
          )?.result_version_id,
          null
        );
        assert.strictEqual(
          db.orm.get('SELECT status FROM material_versions WHERE id=2')?.status,
          stage === 'publication' ? 'draft' : 'published'
        );
        db.exec('INSERT INTO project_pages(project_id,page_id) VALUES(1,3)');
        assert.doesNotThrow(() => db.exec(write));
        expect(db.orm.all('PRAGMA foreign_key_check')).toStrictEqual([]);
      } finally {
        await close();
      }
    }
  );
}

testStable(
  'publication cannot replace a captured revision with another revision of the same member',
  async () => {
    const { db, close } = await fixture();

    try {
      db.exec("UPDATE material_versions SET generation_request_id='request' WHERE id=2");
      const publish = () =>
        db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=2");

      assert.throws(publish);
      db.exec(
        'INSERT INTO material_evidence_inputs(version_id,page_version_id,position) VALUES(2,3,1)'
      );
      assert.throws(publish);
      db.exec(
        'INSERT INTO material_evidence_inputs(version_id,page_version_id,position) VALUES(2,1,0)'
      );
      assert.throws(publish);
      db.exec('DELETE FROM material_evidence_inputs WHERE version_id=2 AND page_version_id=3');
      assert.doesNotThrow(publish);
      expect(
        db.orm
          .all('SELECT page_version_id FROM material_evidence_inputs WHERE version_id=2')
          .map((row) => row.page_version_id)
      ).toStrictEqual([1n]);
      expect(db.orm.all('PRAGMA foreign_key_check')).toStrictEqual([]);
    } finally {
      await close();
    }
  }
);
