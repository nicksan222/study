import { Db, sql } from '@study/db';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines child-process scenarios used to exercise automatic test fixture setup,     │
 * │ database isolation, cleanup, retries, and cleanup failures. Scenario selection is        │
 * │ controlled by STUDY_TEST_SCENARIO.                                                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Branches on STUDY_TEST_SCENARIO to exercise fixture setup failures, isolated           │
 * │   databases, cleanup retries, and concurrent test contexts.                              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Launched by automatic-fixture.test.ts with STUDY_TEST_SCENARIO; it logs fixture paths so │
 * │ the parent test can verify cleanup.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect } from 'effect';

import { Projects } from '#server/features/projects/index';

const mode = process.env.STUDY_TEST_SCENARIO;

if (mode === 'unused') {
  test.stable('pure tests do not allocate database fixtures', async () => {
    const fixtures = await Array.fromAsync(
      new Bun.Glob('study-test-*').scan({ cwd: process.env.TMPDIR!, onlyFiles: false })
    );

    test.expect(fixtures).toEqual([]);
  });
}

if (mode === 'setup-failure') {
  test.stable('fails after fixture setup', async ({ resources }) => {
    const { path } = resources;

    await Bun.write(path, 'setup failed');
    console.log('FIXTURE_PATH', JSON.stringify(path));

    throw new Error('intentional setup failure');
  });
}

if (
  mode !== 'setup-failure' &&
  mode !== 'concurrent' &&
  mode !== 'retry-sync' &&
  mode !== 'retry-async' &&
  mode !== 'api-reuse' &&
  mode !== 'unused'
)
  void test.stable('first isolated database', async ({ server: f }) => {
    console.log('FIXTURE_PATH', JSON.stringify(f.path));
    f.dispose(() => {
      test.assert.strictEqual(
        f.store.db.orm.get<{ value: bigint }>(sql`SELECT 1 AS value`)?.value,
        1n
      );
      console.log('LIVE_SQL_DURING_DISPOSAL');
    });

    if (mode === 'cleanup-throw' || mode === 'failure-cleanup-throw') {
      f.dispose(() => console.log('CLEANUP_AFTER_THROW'));
      f.dispose(() => {
        console.log('CLEANUP_THROWN');

        throw new Error('intentional disposer failure');
      });
    }

    const project = await f.app.nativeRuntime.runPromise(
      Effect.flatMap(Projects, (projects) => projects.createProject({ name: 'First' }))
    );

    test.assert.strictEqual(project.name, 'First');
    let reopened: Db;

    f.dispose(() => {
      test.assert.throws(() => reopened.exec('SELECT 1'));
      console.log('EXTRA_CONNECTION_CLOSED');
    });
    reopened = f.manage(await Db.open(f.path));

    try {
      test.assert.strictEqual(
        reopened.orm.get<{ name: string }>(sql`SELECT name FROM projects`)?.name,
        'First'
      );
    } finally {
      reopened.close();
    }

    if (mode === 'failure' || mode === 'failure-cleanup-throw')
      test.assert.fail('intentional test failure');
  });

if (mode === 'success') {
  void test.stable('second isolated database', async ({ server: f }) => {
    console.log('FIXTURE_PATH', JSON.stringify(f.path));
    test
      .expect(
        (
          await f.app.nativeRuntime.runPromise(
            Effect.flatMap(Projects, (projects) => projects.projects({ limit: 10 }))
          )
        ).items
      )
      .toStrictEqual([]);
  });
}

if (mode === 'concurrent') {
  let arrived = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const paths: string[] = [];

  test.stable.concurrent.for(['a', 'b'])('concurrent database %s', async (name, { resources }) => {
    const { path, manage } = resources;
    const db = manage(await Db.open(path));

    paths.push(path);
    console.log('FIXTURE_PATH', JSON.stringify(path));

    try {
      db.orm.run(sql`INSERT INTO projects (name, created_at, updated_at) VALUES (${name}, 0, 0)`);

      if (++arrived === 2) release();

      await ready;
      test.assert.strictEqual(
        db.orm.get<{ name: string }>(sql`SELECT name FROM projects`)?.name,
        name
      );
    } finally {
      db.close();
    }
  });
  test.afterAll(() => {
    test.assert.strictEqual(new Set(paths).size, 2);
  });
}

if (mode === 'retry-sync' || mode === 'retry-async') {
  void test.stable('failed close is retried by teardown', async ({ resources: database }) => {
    let attempts = 0;

    await Bun.write(database.path, 'resource exists');
    console.log('FIXTURE_PATH', JSON.stringify(database.path));
    database.dispose(() => {
      test.assert.strictEqual(attempts, 2);
      console.log('RETRIED_CLOSE_BEFORE_FILE_CLEANUP');
    });

    if (mode === 'retry-sync') {
      const resource = database.manage({
        close() {
          attempts++;

          if (attempts === 1) throw new Error('first close fails');
        }
      });

      test.assert.throws(() => resource.close(), /first close fails/);
    } else {
      const resource = database.manage({
        async close() {
          attempts++;

          if (attempts === 1) throw new Error('first close fails');
        }
      });
      const first = resource.close();
      const concurrent = resource.close();

      test.assert.strictEqual(concurrent, first);
      await test.expect(first).rejects.toThrow(/first close fails/);
    }
  });
}

if (mode === 'api-reuse') {
  void test.stable(
    'canonical test helper reuses the app and supports low-level access',
    async ({ server: first, rpc, resources: low }) => {
      test.assert.strictEqual(rpc.app, first.app);
      test.assert.strictEqual(first.store, rpc.app.store);
      test.assert.strictEqual(first.fixture, low);
      console.log('FIXTURE_PATH', JSON.stringify(first.path));

      test.assert.strictEqual(low.path, first.path);
      test.assert.strictEqual(rpc.fixture, low);
      test.assert.strictEqual(low.dir, first.dir);
      test.assert.strictEqual('app' in low, false);
    }
  );
}
