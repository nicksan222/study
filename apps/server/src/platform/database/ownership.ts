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

import { createHash } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';

import { StudyError } from '@study/contracts/errors';

/** Path identity must survive replacing the database inode during restore. */

function databasePath(path: string) {
  const absolute = resolve(path);

  const canonical = existsSync(absolute)
    ? realpathSync(absolute)
    : join(realpathSync(dirname(absolute)), basename(absolute));

  if (existsSync(canonical) && statSync(canonical).nlink > 1)
    throw new StudyError('unsupported', 'Hard-linked database paths cannot be owned exclusively');

  return canonical;
}

/** Kernel-held loopback binding gives all supported launchers a crash-released lease.
 * Hash collisions or occupied ports fail closed; never try an alternate endpoint.
 */

export async function acquireDatabaseOwnership(path: string) {
  if (path === ':memory:') return { path, release: async () => {} };

  const canonical = databasePath(path);

  const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;

  const port = 1024 + (createHash('sha256').update(identity).digest().readUInt32BE(0) % 64512);

  const server = createServer((socket) => socket.destroy());

  server.unref();

  await new Promise<void>((resolveOwnership, reject) => {
    server.once('error', (cause) =>
      reject(new StudyError('transient', 'Database ownership is unavailable', { cause }))
    );
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolveOwnership);
  });

  let released: Promise<void> | undefined;

  return {
    path: canonical,
    release: () => {
      released ??= new Promise<void>((resolveRelease, reject) => {
        server.close((error) => (error ? reject(error) : resolveRelease()));
      });

      return released;
    }
  };
}
