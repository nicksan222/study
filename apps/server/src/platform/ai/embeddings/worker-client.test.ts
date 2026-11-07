/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies cancellation ownership with deterministic worker reply barriers.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Holds native responses until later callers reach the queue.                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses actual worker threads and atomic gates without model downloads or transport mocks.  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { MessageChannel, Worker } from 'node:worker_threads';

import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { makeWorkerClient } from './worker-client.ts';

testStable(
  'cancelled native work retains ownership until its held response is released',
  async () => {
    const gate = new Int32Array(new SharedArrayBuffer(4));
    const control = new MessageChannel();
    const worker = new Worker(
      `
    const { parentPort, workerData } = require('node:worker_threads');
    const gate = new Int32Array(workerData.gate);
    parentPort.on('message', (input) => {
      workerData.control.postMessage(input);
      if (input === 'active') Atomics.wait(gate, 0, 0);
      parentPort.postMessage(input);
    });
    parentPort.postMessage({ ready: true });
  `,
      {
        eval: true,
        workerData: { gate: gate.buffer, control: control.port2 },
        transferList: [control.port2]
      }
    );

    try {
      const client = makeWorkerClient(worker);

      await Effect.runPromise(client.ready);
      const activeController = new AbortController();
      const queuedController = new AbortController();
      const started = once(control.port1, 'message');
      const active = Effect.runPromise(client.perform('active', String), {
        signal: activeController.signal
      });
      const activeCancelled = active.then(
        () => false,
        () => true
      );

      expect(await started).toStrictEqual(['active']);
      const queued = Effect.runPromise(client.perform('cancelled queued request', String), {
        signal: queuedController.signal
      });
      const queuedCancelled = queued.then(
        () => false,
        () => true
      );

      queuedController.abort();
      activeController.abort();
      expect(await activeCancelled).toBe(true);
      expect(await queuedCancelled).toBe(true);
      let settled = false;
      const later = Effect.runPromise(Effect.result(client.perform('later', String))).then(
        (result) => {
          settled = true;

          return result;
        }
      );

      // The native worker cannot reply until this thread releases the atomic gate.
      await setImmediate();
      expect(settled).toBe(false);
      const dispatched = once(control.port1, 'message');

      Atomics.store(gate, 0, 1);
      Atomics.notify(gate, 0);
      expect(await dispatched).toStrictEqual(['later']);
      const result = await later;

      expect(result._tag).toBe('Success');

      if (result._tag === 'Success') expect(result.success).toBe('later');

      expect(await Effect.runPromise(client.perform('subsequent', String))).toBe('subsequent');
    } finally {
      Atomics.store(gate, 0, 1);
      Atomics.notify(gate, 0);
      await worker.terminate();
      control.port1.close();
    }
  }
);
