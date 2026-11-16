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
  test.server.stable('pure tests do not allocate database fixtures', async ({ expect }) => {
    const fixtures = await Array.fromAsync(
      new Bun.Glob('study-test-*').scan({ cwd: process.env.TMPDIR!, onlyFiles: false })
    );

    expect(fixtures).toEqual([]);
  });
}

if (mode === 'setup-failure') {
  test.server.stable('fails after fixture setup', async ({ resources }) => {
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
  void test.server.stable('first isolated database', async ({ server: f, assert: assertions }) => {
    const assert: test.Assert = assertions;

    console.log('FIXTURE_PATH', JSON.stringify(f.path));
    f.dispose(() => {
      assert.strictEqual(f.store.db.orm.get<{ value: bigint }>(sql`SELECT 1 AS value`)?.value, 1n);
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

    assert.strictEqual(project.name, 'First');
    let reopened: Db;

    f.dispose(() => {
      assert.throws(() => reopened.exec('SELECT 1'));
      console.log('EXTRA_CONNECTION_CLOSED');
    });
    reopened = f.manage(await Db.open(f.path));

    try {
      assert.strictEqual(
        reopened.orm.get<{ name: string }>(sql`SELECT name FROM projects`)?.name,
        'First'
      );
    } finally {
      reopened.close();
    }

    if (mode === 'failure' || mode === 'failure-cleanup-throw')
      assert.fail('intentional test failure');
  });

if (mode === 'success') {
  void test.server.stable('second isolated database', async ({ server: f, expect }) => {
    console.log('FIXTURE_PATH', JSON.stringify(f.path));
    expect(
      (
        await f.app.nativeRuntime.runPromise(
          Effect.flatMap(Projects, (projects) => projects.projects({ limit: 10 }))
        )
      ).items
    ).toStrictEqual([]);
  });
}

if (mode === 'concurrent') {
  let arrived = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const paths: string[] = [];

  test.server.stable.concurrent.for(['a', 'b'])(
    'concurrent database %s',
    async (name, { resources, assert: assertions }) => {
      const assert: test.Assert = assertions;

      const { path, manage } = resources;
      const db = manage(await Db.open(path));

      paths.push(path);
      console.log('FIXTURE_PATH', JSON.stringify(path));

      try {
        db.orm.run(sql`INSERT INTO projects (name, created_at, updated_at) VALUES (${name}, 0, 0)`);

        if (++arrived === 2) release();

        await ready;
        assert.strictEqual(new Set(paths).size, 2);
        assert.strictEqual(
          db.orm.get<{ name: string }>(sql`SELECT name FROM projects`)?.name,
          name
        );
      } finally {
        db.close();
      }
    }
  );
}

if (mode === 'retry-sync' || mode === 'retry-async') {
  void test.server.stable(
    'failed close is retried by teardown',
    async ({ resources: database, assert: assertions, expect }) => {
      const assert: test.Assert = assertions;

      let attempts = 0;

      await Bun.write(database.path, 'resource exists');
      console.log('FIXTURE_PATH', JSON.stringify(database.path));
      database.dispose(() => {
        assert.strictEqual(attempts, 2);
        console.log('RETRIED_CLOSE_BEFORE_FILE_CLEANUP');
      });

      if (mode === 'retry-sync') {
        const resource = database.manage({
          close() {
            attempts++;

            if (attempts === 1) throw new Error('first close fails');
          }
        });

        assert.throws(() => resource.close(), /first close fails/);
      } else {
        const resource = database.manage({
          async close() {
            attempts++;

            if (attempts === 1) throw new Error('first close fails');
          }
        });
        const first = resource.close();
        const concurrent = resource.close();

        assert.strictEqual(concurrent, first);
        await expect(first).rejects.toThrow(/first close fails/);
      }
    }
  );
}

if (mode === 'api-reuse') {
  void test.server.stable(
    'canonical test helper reuses the app and supports low-level access',
    async ({ server: first, rpc, resources: low, assert: assertions }) => {
      const assert: test.Assert = assertions;

      assert.strictEqual(rpc.app, first.app);
      assert.strictEqual(first.store, rpc.app.store);
      assert.strictEqual(first.fixture, low);
      console.log('FIXTURE_PATH', JSON.stringify(first.path));

      assert.strictEqual(low.path, first.path);
      assert.strictEqual(rpc.fixture, low);
      assert.strictEqual(low.dir, first.dir);
      assert.strictEqual('app' in low, false);
    }
  );
}
