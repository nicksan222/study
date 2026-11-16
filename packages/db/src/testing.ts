import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { createTestResources, temporaryDirectory } from '@study/testing/resources';
import { Effect, FileSystem, Layer, Path } from 'effect';

import { Db } from './db.ts';

export type TestDatabaseOpenOptions = { migrations: 'current' };

let migrated: Promise<Uint8Array> | undefined;

const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(effect.pipe(Effect.provide(platform)));

/** An isolated on-disk database; disposal closes owned connections before removing files. */
export async function createTestDatabase(migrationsFolder?: string) {
  const resources = createTestResources();
  const directory = await temporaryDirectory();
  const dir = directory.path;
  const path = await run(
    Effect.map(Path.Path, (paths) => paths.join(dir, `${crypto.randomUUID()}.db`))
  );

  resources.defer(() => directory[Symbol.asyncDispose]());
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
    open: (options?: TestDatabaseOpenOptions) =>
      resources.acquire(async () => {
        const path = await prepare();

        return options?.migrations === 'current' ? Db.open(path) : Db.open(path, migrationsFolder);
      }),
    cleanup: resources.close,
    [Symbol.asyncDispose]: resources[Symbol.asyncDispose]
  };
}
