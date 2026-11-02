/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs a supported App owner in a separate process for lifetime regressions.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reports acquisition and performs graceful close on an IPC request.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Test-only process; receives isolated fixture paths and never opens user data.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';

import { App } from '#server/runtime/index';

const path = process.argv[2];

if (!path || !process.send) throw new Error('Expected fixture path and IPC channel');

try {
  const app = await App.open({ path });

  process.on('message', async (message) => {
    if (message !== 'close') return;

    try {
      await app.close();
      process.disconnect?.();
    } catch {
      process.exitCode = 1;
      process.disconnect?.();
    }
  });
  process.send?.({ state: 'owned' });
} catch (cause) {
  process.send?.({
    state: 'rejected',
    kind: cause instanceof StudyError ? cause.kind : 'internal'
  });
  process.disconnect?.();
}
