import { BunFileSystem } from '@effect/platform-bun';
import { Effect, FileSystem } from 'effect';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

/** Turbo results are disposable; evict whole entries rather than leaving orphan sidecars. */
export async function pruneTaskCache(
  directory: string,
  {
    maxBytes = 512 * 1024 * 1024,
    maxAgeMs = 7 * 24 * 60 * 60 * 1000,
    format = 'turbo'
  }: { maxBytes?: number; maxAgeMs?: number; format?: 'turbo' | 'vitest' } = {}
): Promise<void> {
  if (!(await Effect.runPromise(fs.exists(directory)))) return;

  const entries = await cacheEntries(directory, format);

  let total = [...entries.values()].reduce((sum, entry) => sum + entry.size, 0);
  const cutoff = Date.now() - maxAgeMs;

  for (const entry of [...entries.values()].sort((left, right) => left.modified - right.modified)) {
    if (total <= maxBytes && entry.modified > cutoff) continue;

    for (const file of entry.files) await Effect.runPromise(fs.remove(file, { force: true }));

    total -= entry.size;
  }
}

async function cacheEntries(directory: string, format: 'turbo' | 'vitest') {
  const entries = new Map<string, { files: string[]; size: number; modified: number }>();

  const pattern =
    format === 'vitest'
      ? /^([a-f0-9]{40})$/
      : /^([a-f0-9]{16})(?:\.tar\.zst|-(?:meta|manifest)\.json)$/;

  for (const name of await Effect.runPromise(fs.readDirectory(directory))) {
    const hash = pattern.exec(name)?.[1];

    if (!hash) continue;

    const file = `${directory}/${name}`;

    if ((await Effect.runPromise(fs.lstat(file))).type !== 'File') continue;

    const data = Bun.file(file);
    const entry = entries.get(hash) ?? { files: [], size: 0, modified: 0 };

    entry.files.push(file);
    entry.size += data.size;
    entry.modified = Math.max(entry.modified, data.lastModified);
    entries.set(hash, entry);
  }

  return entries;
}
