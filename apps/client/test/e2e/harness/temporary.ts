import { BunFileSystem } from '@effect/platform-bun';
import { Effect, FileSystem } from 'effect';
import { onTestFinished } from 'vite-plus/test';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

/** Harness contract fixtures are temporary, even when they deliberately exercise failed cleanup. */
export async function temporaryArtifacts(): Promise<string> {
  const parent = Bun.fileURLToPath(new URL('../../../../../target/test-fixtures', import.meta.url));

  await Effect.runPromise(fs.makeDirectory(parent, { recursive: true }));
  const directory = await Effect.runPromise(
    fs.makeTempDirectory({ directory: parent, prefix: 'e2e-' })
  );

  onTestFinished(() => Effect.runPromise(fs.remove(directory, { recursive: true, force: true })));

  return directory;
}
