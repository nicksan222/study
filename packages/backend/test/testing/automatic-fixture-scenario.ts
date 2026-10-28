import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import type { TestContext } from 'node:test';

import { Db } from '@study/db';
import { sql } from 'drizzle-orm';

import { App } from '#backend/runtime/service';

import { createBackendTest } from './backend-test.ts';

const mode = process.env.STUDY_TEST_SCENARIO;

if (mode === 'setup-failure') {
  beforeEach(async (t) => {
    const { path } = createBackendTest(t as TestContext, { app: false });

    writeFileSync(path, 'setup failed');
    console.log('FIXTURE_PATH', JSON.stringify(path));

    throw new Error('intentional setup failure');
  });
}

if (
  mode !== 'concurrent' &&
  mode !== 'retry-sync' &&
  mode !== 'retry-async' &&
  mode !== 'api-reuse'
)
  void test('first isolated database', async (t) => {
    const f = await createBackendTest(t);

    console.log('FIXTURE_PATH', JSON.stringify(f.path));
    f.dispose(() => {
      assert.equal(f.store.db.orm.get<{ value: bigint }>(sql`SELECT 1 AS value`)?.value, 1n);
      console.log('LIVE_SQL_DURING_DISPOSAL');
    });

    if (mode === 'cleanup-throw' || mode === 'failure-cleanup-throw') {
      f.dispose(() => console.log('CLEANUP_AFTER_THROW'));
      f.dispose(() => {
        console.log('CLEANUP_THROWN');

        throw new Error('intentional disposer failure');
      });
    }

    const project = await f.caller.projects.createProject({ name: 'First' });

    assert.equal(project.name, 'First');
    let reopened: Db;

    f.dispose(() => {
      assert.throws(() => reopened.exec('SELECT 1'));
      console.log('EXTRA_CONNECTION_CLOSED');
    });
    reopened = f.manage(Db.open(f.path));

    try {
      assert.equal(
        reopened.orm.get<{ name: string }>(sql`SELECT name FROM projects`)?.name,
        'First'
      );
    } finally {
      reopened.close();
    }

    if (mode === 'failure' || mode === 'failure-cleanup-throw')
      throw new Error('intentional test failure');
  });

if (mode === 'success') {
  void test('second isolated database', async (t) => {
    const f = await createBackendTest(t);

    console.log('FIXTURE_PATH', JSON.stringify(f.path));
    assert.deepEqual((await f.caller.projects.projects({})).items, []);
  });
}

if (mode === 'concurrent') {
  void test('concurrent databases', { concurrency: true }, async (t) => {
    let arrived = 0;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const paths: string[] = [];

    await Promise.all(
      ['a', 'b'].map((name) =>
        t.test(name, async (child) => {
          const { path, manage } = createBackendTest(child, { app: false });
          const db = manage(Db.open(path));

          paths.push(path);
          console.log('FIXTURE_PATH', JSON.stringify(path));

          try {
            db.orm.run(
              sql`INSERT INTO projects (name, created_at, updated_at) VALUES (${name}, 0, 0)`
            );

            if (++arrived === 2) release();

            await ready;
            assert.equal(db.orm.get<{ name: string }>(sql`SELECT name FROM projects`)?.name, name);
          } finally {
            db.close();
          }
        })
      )
    );
    assert.equal(new Set(paths).size, 2);
  });
}

if (mode === 'retry-sync' || mode === 'retry-async') {
  void test('failed close is retried by teardown', async (t) => {
    const database = createBackendTest(t, { app: false });
    let attempts = 0;

    writeFileSync(database.path, 'resource exists');
    console.log('FIXTURE_PATH', JSON.stringify(database.path));
    database.dispose(() => {
      assert.equal(attempts, 2);
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

      assert.equal(concurrent, first);
      await assert.rejects(first, /first close fails/);
    }
  });
}

if (mode === 'api-reuse') {
  void test('canonical test helper reuses the app and supports low-level access', async (t) => {
    const low = createBackendTest(t, { app: false });
    const extra = low.manage(await App.open({ path: low.path }));

    await extra.close();

    const first = await createBackendTest(t);
    const again = await createBackendTest(t);

    assert.equal(first, again);
    assert.equal(first.app, again.app);
    assert.equal(first.caller, again.caller);
    console.log('FIXTURE_PATH', JSON.stringify(first.path));

    assert.equal(low.path, first.path);
    assert.equal(low.dir, first.dir);
    assert.equal('app' in low, false);
  });
}
