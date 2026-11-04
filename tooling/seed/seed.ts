import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { Db } from '@study/db';
import { acquireDatabaseOwnership } from '@study/server/runtime';

import { demoProjects } from './fixtures/index.ts';
import { seedScenario } from './harnesses/scenario.ts';
import type { ProjectDefinition } from './harnesses/scope.ts';
import type { SeedSummary } from './types.ts';

function buildDatabase(path: string, projects: readonly ProjectDefinition[]) {
  const db = Db.open(path);
  let summary: SeedSummary;

  try {
    summary = seedScenario(db, projects);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }

  Db.validateSnapshot(path);

  return summary;
}

/** Replace only after a complete seed validates; share the runtime's exclusive ownership fence. */
export async function seedDatabase(
  path: string,
  projects: readonly ProjectDefinition[] = demoProjects
): Promise<SeedSummary> {
  const absolute = resolve(path);

  await mkdir(dirname(absolute), { recursive: true });

  const ownership = await acquireDatabaseOwnership(absolute);
  let staging: string | undefined;

  try {
    staging = await mkdtemp(join(dirname(ownership.path), '.study-seed-'));

    const candidate = join(staging, 'study.sqlite');
    const summary = buildDatabase(candidate, projects);

    // Recover committed WAL pages before replacement; closing removes the old sidecars.
    if (existsSync(ownership.path)) Db.checkpointFile(ownership.path);

    await rename(candidate, ownership.path);

    return summary;
  } finally {
    try {
      if (staging) await rm(staging, { recursive: true, force: true });
    } finally {
      await ownership.release();
    }
  }
}
