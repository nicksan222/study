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

import { makeConversationSearchProjections } from './search.ts';

testStable('conversation projections exclude archived messages and deleting sessions', () => {
  const location = createTestDatabase();
  const db = location.open();

  try {
    db.orm.run(
      sql`INSERT INTO sessions (id,title,title_source,created_at,updated_at) VALUES (1,'Physics','user',1,1)`
    );
    db.orm.run(sql`INSERT INTO messages (id,session_id,role,created_at) VALUES (1,1,'user',1)`);
    db.orm.run(
      sql`INSERT INTO message_versions (id,message_id,number,origin,status,text,created_at) VALUES (1,1,1,'typed','complete','Current text',1)`
    );
    db.orm.run(sql`UPDATE messages SET active_version_id=1 WHERE id=1`);
    db.orm.run(
      sql`INSERT INTO messages (id,session_id,role,created_at) VALUES (2,1,'assistant',1)`
    );
    db.orm.run(
      sql`INSERT INTO message_versions (id,message_id,number,origin,status,text,created_at) VALUES (2,2,1,'answer','pending','',1)`
    );
    db.orm.run(sql`UPDATE messages SET active_version_id=2 WHERE id=2`);
    db.orm.run(
      sql`INSERT INTO sessions (id,title,mode,title_source,created_at,updated_at) VALUES (2,'Private Assistant','assistant','user',1,1)`
    );
    db.orm.run(sql`INSERT INTO messages (id,session_id,role,created_at) VALUES (3,2,'user',1)`);
    db.orm.run(
      sql`INSERT INTO message_versions (id,message_id,number,origin,status,text,created_at) VALUES (3,3,1,'typed','complete','Private Assistant context',1)`
    );
    db.orm.run(sql`UPDATE messages SET active_version_id=3 WHERE id=3`);
    expect(
      makeConversationSearchProjections({ db, clock: Effect.runSync(Clock.Clock) })().map(
        (entry) => entry.target.type
      )
    ).toStrictEqual(['session', 'message']);
    expect(
      makeConversationSearchProjections({ db, clock: Effect.runSync(Clock.Clock) })()[1]?.text
    ).toBe('Current text');
    const read = makeConversationSearchProjections({ db, clock: Effect.runSync(Clock.Clock) });
    const messages = read({ kind: 'message', offset: 0, limit: 1 });

    expect(messages.map((entry) => entry.text)).toStrictEqual(['Current text']);
    expect(
      read({ kind: 'message', offset: 0, limit: 1, targets: messages.map((entry) => entry.target) })
    ).toStrictEqual(messages);
    expect(read({ kind: 'message', offset: 1, limit: 1 })).toStrictEqual([]);
    expect(
      read({ kind: 'session', offset: 0, limit: 1, targets: messages.map((entry) => entry.target) })
    ).toStrictEqual([]);
    db.orm.run(sql`UPDATE messages SET archived_at=2 WHERE id=1`);
    expect(
      makeConversationSearchProjections({ db, clock: Effect.runSync(Clock.Clock) })().map(
        (entry) => entry.target.type
      )
    ).toStrictEqual(['session']);
    db.orm.run(
      sql`INSERT INTO session_deletions (session_id,operation_id,status,created_at) VALUES (1,'delete','pending',2)`
    );
    expect(
      makeConversationSearchProjections({ db, clock: Effect.runSync(Clock.Clock) })()
    ).toStrictEqual([]);
  } finally {
    db.close();
    location.cleanup();
  }
});
