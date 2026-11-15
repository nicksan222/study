import { BunFileSystem } from '@effect/platform-bun';
import { Effect, FileSystem } from 'effect';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

/** Scoped fixture storage; executable files avoid Linux CI's noexec SQLite TMPDIR. */
export async function temporaryDirectory(options: { executable?: boolean } = {}) {
  const path = await Effect.runPromise(
    fs.makeTempDirectory({
      prefix: 'study-test-',
      directory: options.executable && process.platform === 'linux' ? '/tmp' : undefined
    })
  );

  return {
    path,
    [Symbol.asyncDispose]: () =>
      Effect.runPromise(fs.remove(path, { recursive: true, force: true }))
  };
}
