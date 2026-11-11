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

import { Projects } from '#server/features/projects/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';

import { makeProjectSearchProjections } from './search.ts';

testStable(
  'project projections reflect new names and deletions using canonical identities',
  async () => {
    const location = await createTestDatabase();
    const db = await location.open();
    const read = makeProjectSearchProjections({ db, clock: Effect.runSync(Clock.Clock) });

    try {
      db.orm.run(
        sql`INSERT INTO projects (id,name,created_at,updated_at) VALUES (1,'Physics',1,1)`
      );
      expect(read()).toStrictEqual([
        {
          target: { type: 'project', id: 1n },
          title: 'Physics',
          text: 'Physics',
          projectIds: [1n],
          revision: '1'
        }
      ]);
      db.orm.run(sql`UPDATE projects SET name='Biology',updated_at=2 WHERE id=1`);
      expect(read()[0]?.text).toBe('Biology');
      db.orm.run(sql`DELETE FROM projects WHERE id=1`);
      expect(read()).toStrictEqual([]);
    } finally {
      db.close();
      await location.cleanup();
    }
  }
);

testStable(
  'public projection participant validates pagination through the owning feature store',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());

    try {
      context.db.orm.run(
        sql`INSERT INTO projects (id,name,created_at,updated_at) VALUES (1,'Physics',1,1),(2,'Biology',1,1)`
      );
      const page = (offset: number, limit: number) =>
        transaction((tx) => Projects.searchProjectionsInTransaction(tx, { offset, limit })).pipe(
          Effect.provideService(Database, { store: context })
        );
      const first = await Effect.runPromise(page(0, 1));
      const second = await Effect.runPromise(page(1, 1));

      expect(first.items.map((entry) => entry.title)).toStrictEqual(['Physics']);
      expect(first.next).toBe(1);
      expect(second.items.map((entry) => entry.title)).toStrictEqual(['Biology']);
      expect(second.next).toBeNull();
      expect((await Effect.runPromise(Effect.flip(page(-1, 1)))).kind).toBe('invalid_input');
      expect((await Effect.runPromise(Effect.flip(page(0, 1001)))).kind).toBe('invalid_input');
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
