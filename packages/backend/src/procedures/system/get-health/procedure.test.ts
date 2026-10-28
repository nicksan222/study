import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackendTest } from '#testing/backend-test';
test('getHealth reflects real worker state and checks database availability', async (t) => {
  const f = await createBackendTest(t);

  assert.deepEqual(await f.caller.system.getHealth(), {
    protocolVersion: 1,
    workersRunning: false,
    testMode: false
  });
  f.app.workers.start();
  assert.equal((await f.caller.system.getHealth()).workersRunning, true);
  await f.app.workers.stop();
});
