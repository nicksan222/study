import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { testStable } from '@study/testing/vitest';
import { Effect, FileSystem, Path } from 'effect';
import { expect } from 'vite-plus/test';

import { artifactOwner, retireArtifacts } from './artifacts.ts';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

const path = await Effect.runPromise(Effect.provide(Path.Path, BunPath.layer));

testStable(
  'artifact retention bounds finished attempts without deleting active attempts',
  async () => {
    const root = await Effect.runPromise(
      fs.makeTempDirectory({ prefix: 'study-artifact-retention-' })
    );

    try {
      for (let index = 0; index < 6; index++) {
        await Bun.write(path.join(root, String(index), 'timing.json'), JSON.stringify({ index }));
        await Bun.write(path.join(root, String(index), 'actual.png'), 'image');
        await Effect.runPromise(
          fs.utimes(
            path.join(root, String(index), 'timing.json'),
            new Date(index * 1000),
            new Date(index * 1000)
          )
        );
      }

      await Bun.write(path.join(root, 'active', 'trace.zip'), 'in progress');
      await retireArtifacts(root);
      const entries = await Effect.runPromise(fs.readDirectory(root));

      expect(entries).toHaveLength(4);
      expect(entries).toContain('active');
      expect(entries).toContain('5');
      await retireArtifacts(root);
      expect(await Effect.runPromise(fs.readDirectory(root))).toEqual(entries);
    } finally {
      await Effect.runPromise(fs.remove(root, { recursive: true, force: true }));
    }
  }
);

testStable(
  'artifact retention retires abandoned owners while preserving a live owner',
  async () => {
    const root = await Effect.runPromise(
      fs.makeTempDirectory({ prefix: 'study-abandoned-artifacts-' })
    );

    try {
      for (let index = 0; index < 6; index++)
        await Bun.write(
          path.join(root, String(index), 'owner.json'),
          JSON.stringify({ ...artifactOwner, pid: 2147483647 })
        );

      await Bun.write(path.join(root, 'active', 'owner.json'), JSON.stringify(artifactOwner));
      await retireArtifacts(root);
      const entries = await Effect.runPromise(fs.readDirectory(root));

      expect(entries).toHaveLength(4);
      expect(entries).toContain('active');
    } finally {
      await Effect.runPromise(fs.remove(root, { recursive: true, force: true }));
    }
  }
);
