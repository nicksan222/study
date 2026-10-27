import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { listJobs } from '#backend/procedures/jobs/job-overviews';
import { fixture } from '#testing/procedures';

import { listSources as dbListSources } from './sources.ts';
test('importFiles returns individual success and error results', async (t) => {
  const f = await fixture(t);
  const path = join(f.dir, 'good.txt');

  writeFileSync(path, 'hello');
  const result = await f.caller.sources.importFiles({
    paths: [path, join(f.dir, 'missing.txt')]
  });

  assert.equal(result.items[0]?.type, 'source');
  assert.equal(result.items[1]?.type, 'error');
  assert.equal(
    (
      await f.caller.sources.importFiles({
        paths: []
      })
    ).items.length,
    0
  );
  await assert.rejects(
    f.caller.sources.importFiles({
      paths: Array(101).fill(path)
    }),
    {
      kind: 'invalid_input'
    }
  );
  assert.equal(dbListSources(f.store).length, 1);
});

test('bulk imports commit one processing job per valid path and isolate path failures', async (t) => {
  const f = await fixture(t);
  const first = join(f.dir, 'first.txt');
  const last = join(f.dir, 'last.txt');

  writeFileSync(first, 'First');
  writeFileSync(last, 'Last');

  const result = await f.caller.sources.importFiles({ paths: [first, '', last] });

  assert.deepEqual(
    result.items.map((item) => item.type),
    ['source', 'error', 'source']
  );
  const imported = result.items.flatMap((item) => (item.type === 'source' ? [item.source.id] : []));

  assert.deepEqual(
    listJobs(f.store).map((job) => job.target.id),
    imported
  );
  assert.equal(dbListSources(f.store).length, 2);
});
