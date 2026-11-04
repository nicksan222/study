import assert from 'node:assert/strict';

import { Db } from '@study/db';
import { testStable } from '@study/testing/node';

testStable('snapshot completes without a timer wakeup', async () => {
  const db = Db.openSnapshot(process.env.STUDY_BACKUP_IDLE_SOURCE!);

  // A long-lived server/test timer must not be needed to deliver native completion.
  let watchdogFired = false;

  const watchdog = setTimeout(() => {
    watchdogFired = true;
  }, 5000);

  try {
    await db.snapshot(process.env.STUDY_BACKUP_IDLE_TARGET!);
    // Startup I/O may deliver the first completion; the second copy has no such wakeup.
    await db.snapshot(process.env.STUDY_BACKUP_IDLE_TARGET!);
    assert.equal(watchdogFired, false, 'Snapshot completion waited for the idle watchdog');
  } finally {
    clearTimeout(watchdog);
    db.close();
  }
});
