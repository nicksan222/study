import { BunFileSystem } from '@effect/platform-bun';
import { Effect, FileSystem } from 'effect';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

// PIDs are meaningful only inside the same process namespace. Unknown hosts stay conservative.
export const artifactOwner = {
  pid: process.pid,
  scope: await Promise.all([
    Bun.file('/proc/sys/kernel/random/boot_id').text(),
    Effect.runPromise(fs.readLink('/proc/self/ns/pid'))
  ])
    .then(([boot, namespace]) => `${boot.trim()}:${namespace}`)
    .catch(() => `unknown:${crypto.randomUUID()}`)
};

/** Keep three completed attempts per workflow; live owners keep their files, including attempts interrupted before timings. */
export async function retireArtifacts(directory: string): Promise<void> {
  const completed: { directory: string; modified: number }[] = [];

  for (const name of await Effect.runPromise(fs.readDirectory(directory))) {
    const attempt = `${directory}/${name}`;

    if ((await Effect.runPromise(fs.lstat(attempt))).type !== 'Directory') continue;

    const timing = Bun.file(`${attempt}/timing.json`);

    if (await timing.exists())
      completed.push({ directory: attempt, modified: timing.lastModified });
    else if (await abandoned(attempt))
      completed.push({
        directory: attempt,
        modified: Bun.file(`${attempt}/owner.json`).lastModified
      });
  }

  completed.sort(
    (left, right) => right.modified - left.modified || right.directory.localeCompare(left.directory)
  );

  for (const attempt of completed.slice(3))
    await Effect.runPromise(fs.remove(attempt.directory, { recursive: true, force: true }));
}

async function abandoned(directory: string): Promise<boolean> {
  const owner = Bun.file(`${directory}/owner.json`);

  if (!(await owner.exists())) return false;

  const data: unknown = await owner.json().catch(() => undefined);

  if (!validOwner(data) || data.scope !== artifactOwner.scope) return false;

  const pid = data.pid;

  try {
    process.kill(pid, 0);

    return false;
  } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
  }
}

function validOwner(data: unknown): data is { pid: number; scope?: unknown } {
  if (typeof data !== 'object' || data === null || !('pid' in data)) return false;

  return typeof data.pid === 'number' && Number.isInteger(data.pid) && data.pid > 0;
}
