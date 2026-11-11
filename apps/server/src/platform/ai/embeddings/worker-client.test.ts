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

import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { makeWorkerClient } from './worker-client.ts';

testStable(
  'cancelled native work retains ownership until its held response is released',
  async () => {
    const gate = new Int32Array(new SharedArrayBuffer(4));
    const control = new MessageChannel();

    control.port1.start();
    const script = `
      let gate, control;
      self.onmessage = (event) => {
        const input = event.data;
        if (!gate) {
          gate = new Int32Array(input.gate);
          control = input.control;
          self.postMessage({ ready: true });
          return;
        }
        control.postMessage(input);
        if (input === 'active') Atomics.wait(gate, 0, 0);
        self.postMessage(input);
      };
    `;
    const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
    const worker = new Worker(url);

    try {
      const client = makeWorkerClient(worker);

      worker.postMessage({ gate: gate.buffer, control: control.port2 }, [control.port2]);
      await Effect.runPromise(client.ready);
      const activeController = new AbortController();
      const queuedController = new AbortController();
      const started = nextMessage(control.port1);
      const active = Effect.runPromise(client.perform('active', String), {
        signal: activeController.signal
      });
      const activeCancelled = active.then(
        () => false,
        () => true
      );

      expect(await started).toBe('active');
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
      await Bun.sleep(0);
      expect(settled).toBe(false);
      const dispatched = nextMessage(control.port1);

      Atomics.store(gate, 0, 1);
      Atomics.notify(gate, 0);
      expect(await dispatched).toBe('later');
      const result = await later;

      expect(result._tag).toBe('Success');

      if (result._tag === 'Success') expect(result.success).toBe('later');

      expect(await Effect.runPromise(client.perform('subsequent', String))).toBe('subsequent');
    } finally {
      Atomics.store(gate, 0, 1);
      Atomics.notify(gate, 0);
      worker.terminate();
      URL.revokeObjectURL(url);
      control.port1.close();
    }
  }
);

function nextMessage(port: MessagePort): Promise<unknown> {
  return new Promise((resolve) =>
    port.addEventListener('message', (event) => resolve(event.data), { once: true })
  );
}

testStable('worker startup failure rejects readiness and later requests', async () => {
  const url = URL.createObjectURL(
    new Blob(['throw new Error("initialization failed")'], { type: 'text/javascript' })
  );
  const worker = new Worker(url);
  const client = makeWorkerClient(worker);

  try {
    await expect(Effect.runPromise(client.ready)).rejects.toThrow(
      'Local embedding worker is unavailable'
    );
    await expect(Effect.runPromise(client.perform('later', String))).rejects.toThrow(
      'Local embedding worker is closed'
    );
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
});
