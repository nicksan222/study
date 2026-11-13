import { BunFileSystem } from '@effect/platform-bun';
import { BunPath } from '@effect/platform-bun';
import { Db, eq } from '@study/db';
import { themes } from '@study/db/schema';
import { defaultThemeId, parseTheme, renderThemeCss } from '@study/theme';
import { Effect, FileSystem, Path } from 'effect';

const { join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

const dir = await Effect.runPromise(fs.makeTempDirectory({ prefix: 'study-theme-css-' }));

try {
  const db = await Db.open(join(dir, 'study.db'));

  try {
    const row = db.orm.select().from(themes).where(eq(themes.id, defaultThemeId)).get();

    if (!row || !row.builtin) throw new Error('Missing default theme migration');

    const theme = parseTheme(JSON.stringify(row.definition));
    const path = new URL('../../../packages/ui/src/theme.css', import.meta.url);
    const current = await Bun.file(path).text();
    const marker = '/* Generated from the T3 Code database theme. */';
    const boundary = current.indexOf(marker);

    if (boundary === -1) throw new Error('Missing generated theme CSS marker');

    const expected = `${current.slice(0, boundary).trimEnd()}\n\n${renderThemeCss(theme)}`;

    const check = process.argv.includes('--check');

    if (check && current !== expected) throw new Error('Theme CSS is stale. Run bun gen.');

    if (!check) await Bun.write(path, expected);
  } finally {
    db.close();
  }
} finally {
  await Effect.runPromise(fs.remove(dir, { recursive: true, force: true }));
}
