import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { Effect, FileSystem, Layer, Path } from 'effect';

import { Db } from './db.ts';

let migrated: Promise<Uint8Array> | undefined;

const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(effect.pipe(Effect.provide(platform)));

/** An isolated on-disk database location for tests; callers close connections before cleanup. */
export async function createTestDatabase(migrationsFolder?: string) {
  const { dir, path } = await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;
      const dir = yield* fs.makeTempDirectory({ prefix: 'study-test-' });

      return { dir, path: paths.join(dir, `${crypto.randomUUID()}.db`) };
    })
  );
  let prepared = false;
  let preparing: Promise<string> | undefined;

  function prepare(): Promise<string> {
    return (preparing ??= prepareOnce());
  }

  async function prepareOnce() {
    if (prepared || migrationsFolder !== undefined || (await Bun.file(path).exists())) return path;

    if (!migrated) {
      migrated = (async () => {
        const db = await Db.open(path);

        db.close();

        return new Uint8Array(await Bun.file(path).arrayBuffer());
      })();
      await migrated;
    } else {
      const bytes = await migrated;

      await run(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          yield* fs.writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
        })
      );
    }

    prepared = true;

    return path;
  }

  return {
    dir,
    path,
    prepare,
    open: async () => Db.open(await prepare(), migrationsFolder),
    cleanup: () =>
      run(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          yield* fs.remove(dir, { recursive: true, force: true });
        })
      )
  };
}
