import { BunFileSystem } from '@effect/platform-bun';
import { test } from '@study/testing';
import { Effect, FileSystem } from 'effect';

import { maintainTaskCaches, pruneTaskCache } from './task-cache.ts';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

test.unit.stable(
  'task cache evicts old archives with their sidecars and preserves unrelated files',
  async ({ temporaryDirectory, expect }) => {
    await using temp = await temporaryDirectory({ prefix: 'study-task-cache-' });
    const directory = temp.path;

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
  }
);

test.unit.stable(
  'transform cache eviction bounds revision history without following symlinks',
  async ({ temporaryDirectory, expect }) => {
    await using temp = await temporaryDirectory({ prefix: 'study-transform-cache-' });
    const directory = temp.path;

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
  }
);

test.unit.stable(
  'a broken Turbo cache does not disable transform-cache retirement',
  async ({ temporaryDirectory, expect }) => {
    await using temp = await temporaryDirectory({ prefix: 'study-independent-caches-' });
    const directory = temp.path;

    await Bun.write(`${directory}/.turbo/cache`, 'not a directory');
    const entry = `${directory}/node_modules/.vitest-cache/${'a'.repeat(40)}`;

    await Bun.write(entry, 'expired');
    await Effect.runPromise(fs.utimes(entry, new Date(0), new Date(0)));
    const results = await maintainTaskCaches(`${directory}/`);

    expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled']);
    expect(await Bun.file(entry).exists()).toBe(false);
  }
);
