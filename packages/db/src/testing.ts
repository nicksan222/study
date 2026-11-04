import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Db } from './db.ts';

/** An isolated on-disk database location for tests; callers close connections before cleanup. */
export function createTestDatabase(migrationsFolder?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'study-test-'));
  const path = join(dir, `${randomUUID()}.db`);

  return {
    dir,
    path,
    open: () => Db.open(path, migrationsFolder),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}
