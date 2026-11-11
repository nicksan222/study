import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { testStable } from '@study/testing/vitest';
import { Effect, FileSystem, Path } from 'effect';
import { expect } from 'vite-plus/test';

import { pruneOnnx } from './prune-onnx.ts';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

const { join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

testStable(
  'keeps the selected target and its companions, rejecting unknown layouts before deletion',
  async () => {
    const root = await Effect.runPromise(fs.makeTempDirectory({ prefix: 'onnx-prune-' }));

    try {
      for (const target of [
        'linux/x64',
        'linux/arm64',
        'darwin/arm64',
        'win32/x64',
        'win32/arm64'
      ]) {
        await Effect.runPromise(fs.makeDirectory(join(root, target), { recursive: true }));
        await Bun.write(join(root, target, 'onnxruntime_binding.node'), target);
        await Bun.write(join(root, target, 'companion'), target);
      }

      await Effect.runPromise(fs.makeDirectory(join(root, 'unknown')));
      await expect(pruneOnnx(root, 'linux', 'arm64')).rejects.toThrow();
      expect((await Effect.runPromise(fs.readDirectory(join(root, 'linux')))).sort()).toEqual([
        'arm64',
        'x64'
      ]);
      await Effect.runPromise(fs.remove(join(root, 'unknown'), { recursive: true }));
      await expect(pruneOnnx(root, 'darwin', 'x64')).rejects.toThrow();
      await pruneOnnx(root, 'linux', 'arm64');
      expect(await Effect.runPromise(fs.readDirectory(root))).toEqual(['linux']);
      expect(
        (await Effect.runPromise(fs.readDirectory(join(root, 'linux', 'arm64')))).sort()
      ).toEqual(['companion', 'onnxruntime_binding.node']);
    } finally {
      await Effect.runPromise(fs.remove(root, { recursive: true, force: true }));
    }
  }
);
