/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies bounded model download writes and stream cancellation with real files.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts failed downloads cancel and unlock their response streams.                     │
 * │ - Asserts completed downloads preserve bytes without cancelling their streams.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses real Web Streams and exclusive temporary files without network downloads.           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunFileSystem } from '@effect/platform-bun';
import { testStable } from '@study/testing/vitest';
import { Effect, FileSystem } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { writeDownload } from './model.ts';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

for (const failure of ['size', 'file'] as const)
  testStable(
    `failed embedding ${failure} boundary cancels its stream and releases the reader`,
    async () => {
      const directory = await Effect.runPromise(
        fs.makeTempDirectory({ prefix: 'study-download-' })
      );
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
        },
        cancel() {
          cancelled = true;
        }
      });

      try {
        await expect(
          writeDownload(body, failure === 'file' ? directory : `${directory}/asset`, 2)
        ).rejects.toBeDefined();
        assert.strictEqual(cancelled, true);
        assert.strictEqual(body.locked, false);
      } finally {
        await body.cancel();
        await Effect.runPromise(fs.remove(directory, { recursive: true }));
      }
    }
  );

testStable(
  'completed embedding download preserves its bytes without cancelling the stream',
  async () => {
    const directory = await Effect.runPromise(fs.makeTempDirectory({ prefix: 'study-download-' }));
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
      cancel() {
        cancelled = true;
      }
    });

    try {
      await writeDownload(body, `${directory}/asset`, 3);
      assert.deepStrictEqual(
        new Uint8Array(await Bun.file(`${directory}/asset`).arrayBuffer()),
        new Uint8Array([1, 2, 3])
      );
      assert.strictEqual(cancelled, false);
      assert.strictEqual(body.locked, false);
    } finally {
      await Effect.runPromise(fs.remove(directory, { recursive: true }));
    }
  }
);
