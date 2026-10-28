import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { listJobs } from '#backend/procedures/jobs/operations/job-overviews';
import { listSources as dbListSources } from '#backend/procedures/sources/operations/sources';
import { createBackendTest } from '#testing/backend-test';
test('importFile reads a real file into the source store', async (t) => {
  const f = await createBackendTest(t);
  const path = join(f.dir, 'notes.txt');

  writeFileSync(path, 'Imported text');
  const source = await f.caller.sources.importFile({
    path
  });

  assert.equal(source.name, 'notes.txt');
  assert.equal(dbListSources(f.store).find((item) => item.name === source.name)?.sizeBytes, 13n);
  await assert.rejects(
    f.caller.sources.importFile({
      path: join(f.dir, 'missing.txt')
    })
  );
  assert.equal(dbListSources(f.store).length, 1);
});

test('file imports roll back the source if enqueue fails and publish only after commit', async (t) => {
  const f = await createBackendTest(t);
  const path = join(f.dir, 'notes.txt');

  writeFileSync(path, 'Body');
  const committed: { sources: number; jobs: number }[] = [];
  const unsubscribe = f.store.subscribe(() => {
    committed.push({ sources: dbListSources(f.store).length, jobs: listJobs(f.store).length });
  });

  f.dispose(unsubscribe);

  f.store.db.exec(
    "CREATE TEMP TRIGGER reject_import_job BEFORE INSERT ON main.jobs BEGIN SELECT RAISE(ABORT, 'cannot enqueue'); END"
  );

  await assert.rejects(f.caller.sources.importFile({ path }));
  assert.deepEqual(dbListSources(f.store), []);
  assert.deepEqual(listJobs(f.store), []);
  assert.deepEqual(committed, []);
  f.store.db.exec('DROP TRIGGER reject_import_job');

  const source = await f.caller.sources.importFile({ path });

  assert.deepEqual(committed, [{ sources: 1, jobs: 1 }]);
  assert.deepEqual(listJobs(f.store)[0]?.target, { type: 'source', id: source.id });
});
