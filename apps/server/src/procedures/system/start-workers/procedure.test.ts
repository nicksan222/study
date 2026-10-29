import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServerTest } from '#testing/server-test';
test('startWorkers starts the application worker lifecycle idempotently', async (t) => {
  const f = await createServerTest(t);

  assert.equal(f.app.workers.started, false);
  await f.caller.system.startWorkers();
  assert.equal(f.app.workers.started, true);
  await f.caller.system.startWorkers({});
  assert.equal(f.app.workers.started, true);
  await f.app.workers.stop();
});
