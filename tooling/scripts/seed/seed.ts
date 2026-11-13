import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { Db } from '@study/db';
import { acquireDatabaseOwnership } from '@study/server/runtime/ownership';
import { Effect, FileSystem, Path } from 'effect';

import { demoProjects } from './fixtures/index.ts';
import { seedScenario } from './harnesses/scenario.ts';
import type { ProjectDefinition } from './harnesses/scope.ts';
import type { SeedSummary } from './types.ts';

const { dirname, join, resolve } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

async function buildDatabase(path: string, projects: readonly ProjectDefinition[]) {
  const db = await Db.open(path);
  let summary: SeedSummary;

  try {
    summary = seedScenario(db, projects);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }

  await Db.validateSnapshot(path);

  return summary;
}

/** Replace only after a complete seed validates; share the runtime's exclusive ownership fence. */
export async function seedDatabase(
  path: string,
  projects: readonly ProjectDefinition[] = demoProjects
): Promise<SeedSummary> {
  const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));
  const absolute = resolve(path);

  await Effect.runPromise(fs.makeDirectory(dirname(absolute), { recursive: true }));

  const ownership = await acquireDatabaseOwnership(absolute);
  let staging: string | undefined;

  try {
    staging = await Effect.runPromise(
      fs.makeTempDirectory({ directory: dirname(ownership.path), prefix: '.study-seed-' })
    );

    const candidate = join(staging, 'study.sqlite');
    const summary = await buildDatabase(candidate, projects);

    // Recover committed WAL pages before replacement; closing removes the old sidecars.
    if (await Bun.file(ownership.path).exists()) await Db.checkpointFile(ownership.path);
    else
      await Promise.all([
        Effect.runPromise(fs.remove(ownership.path + '-wal', { force: true })),
        Effect.runPromise(fs.remove(ownership.path + '-shm', { force: true }))
      ]);

    await Effect.runPromise(fs.rename(candidate, ownership.path));

    return summary;
  } finally {
    try {
      if (staging) await Effect.runPromise(fs.remove(staging, { recursive: true, force: true }));
    } finally {
      await ownership.release();
    }
  }
}
