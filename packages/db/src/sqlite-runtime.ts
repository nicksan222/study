/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Configures the SQLite library used by Bun on macOS.                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Selects the shipped extension-capable library before the application opens SQLite.     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the bundled library in releases and Homebrew SQLite during local development.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

let configured = false;

/** Bun uses the restricted system SQLite on macOS unless a full library is selected. */
export function configureSqliteRuntime() {
  if (configured || !process.versions.bun || process.platform !== 'darwin') return;

  const bundled = join(dirname(process.execPath), 'libsqlite3.dylib');
  const library = existsSync(bundled)
    ? bundled
    : join(
        execFileSync('brew', ['--prefix', 'sqlite'], { encoding: 'utf8' }).trim(),
        'lib/libsqlite3.dylib'
      );
  const sqlite: { Database: { setCustomSQLite(path: string): boolean } } = createRequire(
    import.meta.url
  )('bun:sqlite');

  if (!sqlite.Database.setCustomSQLite(library))
    throw new Error('Cannot load the extension-capable SQLite library');

  configured = true;
}
