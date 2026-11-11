/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies published source search projections against real SQLite database records. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises version publication, scope changes and anchored passage retrieval.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses temporary database files and the feature search projection without running models.  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Clock, Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { makeSourceSearchProjections } from './search.ts';

testStable(
  'source projections expose only published passages and current project membership',
  async () => {
    const location = await createTestDatabase();
    const db = await location.open();

    try {
      db.orm.run(
        sql`INSERT INTO projects (id,name,created_at,updated_at) VALUES (1,'Science',1,1),(2,'Other',1,1)`
      );
      db.orm.run(
        sql`INSERT INTO sources (id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES (1,1,'attachment','text','text/plain','Notes',1,zeroblob(32),1)`
      );
      db.orm.run(
        sql`INSERT INTO content_snapshots (id,source_id,extractor_version,meta,created_at) VALUES (1,1,1,'{}',1),(2,1,1,'{}',2),(3,1,1,'{}',3)`
      );
      db.orm.run(
        sql`INSERT INTO chunks (id,document_id,ordinal,first_block,last_block,anchor,text,content_hash) VALUES (1,1,0,0,0,'{"type":"page","page":1}','obsolete fossils',zeroblob(32)),(2,2,0,0,0,'{"type":"page","page":2}','current molecules',zeroblob(32)),(3,3,0,0,0,'{"type":"page","page":3}','unpublished atoms',zeroblob(32))`
      );
      db.orm.run(
        sql`INSERT INTO source_processing (source_id,revision,request_id,document_id,published_request_id) VALUES (1,1,'request',2,'request')`
      );
      const entries = makeSourceSearchProjections({ db, clock: Effect.runSync(Clock.Clock) })();

      expect(entries.map((entry) => entry.target.type)).toStrictEqual(['source', 'passage']);
      expect(entries[1]?.text).toBe('current molecules');
      expect(entries[1]?.target).toStrictEqual({
        type: 'passage',
        chunkId: 2n,
        sourceId: 1n,
        documentId: 2n,
        anchor: { type: 'page', page: 2 }
      });
      expect(
        entries.every((entry) => entry.projectIds.length === 1 && entry.projectIds[0] === 1n)
      ).toBe(true);
      db.orm.run(sql`UPDATE sources SET project_id=2 WHERE id=1`);
      expect(
        makeSourceSearchProjections({ db, clock: Effect.runSync(Clock.Clock) })().every(
          (entry) => entry.projectIds[0] === 2n
        )
      ).toBe(true);
      db.orm.run(sql`DELETE FROM sources WHERE id=1`);
      expect(
        makeSourceSearchProjections({ db, clock: Effect.runSync(Clock.Clock) })()
      ).toStrictEqual([]);
    } finally {
      db.close();
      await location.cleanup();
    }
  }
);

testStable(
  'passage pages apply kind, offset and target filters before decoding unrelated anchors',
  async () => {
    const location = await createTestDatabase();
    const db = await location.open();
    const read = makeSourceSearchProjections({ db, clock: Effect.runSync(Clock.Clock) });

    try {
      db.orm.run(
        sql`INSERT INTO sources (id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES (1,'attachment','text','text/plain','Notes',1,zeroblob(32),1)`
      );
      db.orm.run(
        sql`INSERT INTO content_snapshots (id,source_id,extractor_version,meta,created_at) VALUES (1,1,1,'{}',1)`
      );
      db.orm.run(
        sql`INSERT INTO chunks (id,document_id,ordinal,first_block,last_block,anchor,text,content_hash) VALUES (1,1,0,0,0,'{"type":"page","page":1}','first',zeroblob(32)),(2,1,1,1,1,'{"type":"page","page":2}','second',zeroblob(32))`
      );
      db.orm.run(
        sql`INSERT INTO source_processing (source_id,revision,request_id,document_id,published_request_id) VALUES (1,1,'request',1,'request')`
      );
      const page = read({ offset: 1, limit: 1, kind: 'passage' });

      expect(page.map((entry) => entry.text)).toStrictEqual(['second']);
      db.orm.run(sql`UPDATE chunks SET anchor='{"type":"unsupported"}' WHERE id=1`);
      expect(
        read({ offset: 0, limit: 10, kind: 'passage', targets: page.map((entry) => entry.target) })
      ).toStrictEqual(page);
      expect(
        read({ offset: 0, limit: 10, kind: 'source', targets: page.map((entry) => entry.target) })
      ).toStrictEqual([]);
    } finally {
      db.close();
      await location.cleanup();
    }
  }
);
