import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Db } from './db.ts';

let migrated: Buffer | undefined;

/** An isolated on-disk database location for tests; callers close connections before cleanup. */
export function createTestDatabase(migrationsFolder?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'study-test-'));
  const path = join(dir, `${randomUUID()}.db`);
  let prepared = false;

  function prepare() {
    if (prepared || migrationsFolder !== undefined || existsSync(path)) return path;

    if (migrated) {
      writeFileSync(path, migrated, { mode: 0o600 });
    } else {
      // Closing the sole connection checkpoints WAL before capturing the empty database.
      Db.open(path).close();
      migrated = readFileSync(path);
    }

    prepared = true;

    return path;
  }

  return {
    dir,
    path,
    // App fixtures prepare explicitly before opening their own connection.
    prepare,
    open: () => Db.open(prepare(), migrationsFolder),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}
