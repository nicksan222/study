import { BunFileSystem } from '@effect/platform-bun';
import { testStable } from '@study/testing/vitest';
import { Effect, FileSystem } from 'effect';
import { expect } from 'vite-plus/test';

import { pruneTaskCache } from './task-cache.ts';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

testStable(
  'task cache evicts old archives with their sidecars and preserves unrelated files',
  async () => {
    const directory = await Effect.runPromise(
      fs.makeTempDirectory({ prefix: 'study-task-cache-' })
    );

    try {
      for (const hash of ['0000000000000001', '0000000000000002']) {
        await Bun.write(`${directory}/${hash}.tar.zst`, new Uint8Array(100));
        await Bun.write(`${directory}/${hash}-meta.json`, '{}');
        await Bun.write(`${directory}/${hash}-manifest.json`, '{}');
        const timestamp = new Date(Date.now() - (hash.endsWith('1') ? 2000 : 1000));

        for (const suffix of ['.tar.zst', '-meta.json', '-manifest.json'])
          await Effect.runPromise(fs.utimes(`${directory}/${hash}${suffix}`, timestamp, timestamp));
      }

      await Bun.write(`${directory}/unrelated`, 'preserve');
      await pruneTaskCache(directory, { maxBytes: 110 });
      const entries = await Effect.runPromise(fs.readDirectory(directory));

      expect(entries).toHaveLength(4);
      expect(entries).toContain('unrelated');
      expect(entries).toContain('0000000000000002.tar.zst');
      await pruneTaskCache(directory, { maxAgeMs: 0 });
      expect(await Effect.runPromise(fs.readDirectory(directory))).toEqual(['unrelated']);
      await pruneTaskCache(`${directory}/missing`);
    } finally {
      await Effect.runPromise(fs.remove(directory, { recursive: true, force: true }));
    }
  }
);

testStable(
  'transform cache eviction bounds revision history without following symlinks',
  async () => {
    const directory = await Effect.runPromise(
      fs.makeTempDirectory({ prefix: 'study-transform-cache-' })
    );

    try {
      const hash = 'a'.repeat(40);

      await Bun.write(`${directory}/${hash}`, new Uint8Array(100));
      await Bun.write(`${directory}/keep`, 'not a cache entry');
      await Effect.runPromise(fs.symlink(`${directory}/keep`, `${directory}/${'b'.repeat(40)}`));
      await pruneTaskCache(directory, { format: 'vitest', maxBytes: 50 });
      expect(await Bun.file(`${directory}/${hash}`).exists()).toBe(false);
      expect(await Bun.file(`${directory}/keep`).text()).toBe('not a cache entry');
      expect((await Effect.runPromise(fs.lstat(`${directory}/${'b'.repeat(40)}`))).type).toBe(
        'SymbolicLink'
      );
    } finally {
      await Effect.runPromise(fs.remove(directory, { recursive: true, force: true }));
    }
  }
);
