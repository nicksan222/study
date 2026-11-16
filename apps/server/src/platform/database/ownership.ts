/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Holds exclusive process-lifetime ownership before database startup or restore.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Rejects overlapping runtime owners of one canonical database path.                     │
 * │ - Uses an OS-owned endpoint that releases on process exit without stale lock files.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This is a local lifetime fence, not a transport; no application data is exchanged.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { StudyError } from '@study/contracts';
import { CryptoHasher, listen } from 'bun';
import type { SocketHandler } from 'bun';
import { Effect, FileSystem, Layer, Option, Path } from 'effect';

import { runFileSystemPromise } from '#server/platform/filesystem/index';

/** Path identity must survive replacing the database inode during restore. */

async function databasePath(path: string) {
  return runFileSystemPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;
      const absolute = paths.resolve(path);
      const exists = yield* fs.exists(absolute);
      const canonical = exists
        ? yield* fs.realPath(absolute)
        : paths.join(yield* fs.realPath(paths.dirname(absolute)), paths.basename(absolute));

      if (exists && Option.getOrElse((yield* fs.stat(canonical)).nlink, () => 0n) > 1n)
        return yield* Effect.fail(
          new StudyError('unsupported', 'Hard-linked database paths cannot be owned exclusively')
        );

      return canonical;
    }).pipe(Effect.provide(Layer.merge(BunFileSystem.layer, BunPath.layer)))
  );
}

/** Kernel-held bindings release on process exit without stale filesystem entries.
 * Linux uses the full path hash in an abstract socket, outside the TCP port namespace.
 * Other platforms retain the loopback lease. Occupied endpoints always fail closed.
 */

export async function acquireDatabaseOwnership(path: string) {
  if (path === ':memory:') return { path, release: async () => {} };

  const canonical = await databasePath(path);

  const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;

  const digest = new CryptoHasher('sha256').update(identity).digest('hex');
  const socket: SocketHandler = {
    data: () => {},
    open: (connection) => {
      connection.end();
    }
  };

  let server: { stop(closeActiveConnections?: boolean): void };

  try {
    server =
      process.platform === 'linux'
        ? listen({ unix: `\0study-database-${digest}`, socket })
        : listen({
            hostname: '127.0.0.1',
            port: 1024 + (Number.parseInt(digest.slice(0, 8), 16) % 64512),
            socket
          });
  } catch (cause) {
    throw new StudyError('transient', 'Database ownership is unavailable', { cause });
  }

  let released: Promise<void> | undefined;

  return {
    path: canonical,
    release: () =>
      (released ??= Promise.resolve().then(() => {
        server.stop(true);
      }))
  };
}
