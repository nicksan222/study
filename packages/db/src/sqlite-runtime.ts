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

import { Database } from 'bun:sqlite';

let configured: Promise<void> | undefined;

/** Bun uses the restricted system SQLite on macOS unless a full library is selected. */
export function configureSqliteRuntime(): Promise<void> {
  if (process.platform !== 'darwin') return Promise.resolve();

  return (configured ??= (async () => {
    const bundled = Bun.fileURLToPath(
      new URL('libsqlite3.dylib', Bun.pathToFileURL(process.execPath))
    );
    let library = bundled;

    if (!(await Bun.file(bundled).exists())) {
      const child = Bun.spawn(['brew', '--prefix', 'sqlite'], { stdout: 'pipe', stderr: 'pipe' });
      const [prefix, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited
      ]);

      if (status !== 0) throw new Error(`Cannot locate SQLite library: ${stderr}`);

      library = Bun.fileURLToPath(
        new URL('lib/libsqlite3.dylib', Bun.pathToFileURL(`${prefix.trim()}/`))
      );
    }

    if (!Database.setCustomSQLite(library))
      throw new Error('Cannot load the extension-capable SQLite library');
  })());
}
