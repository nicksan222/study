import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Db, eq } from '@study/db';
import { themes } from '@study/db/schema';
import { defaultThemeId, parseTheme, renderThemeCss } from '@study/theme';

const dir = mkdtempSync(join(tmpdir(), 'study-theme-css-'));

try {
  const db = Db.open(join(dir, 'study.db'));

  try {
    const row = db.orm.select().from(themes).where(eq(themes.id, defaultThemeId)).get();

    if (!row || !row.builtin) throw new Error('Missing default theme migration');

    const theme = parseTheme(JSON.stringify(row.definition));
    const path = new URL('../../packages/ui/src/theme.css', import.meta.url);
    const current = readFileSync(path, 'utf8');
    const marker = '/* Generated from the T3 Code database theme. */';
    const boundary = current.indexOf(marker);

    if (boundary === -1) throw new Error('Missing generated theme CSS marker');

    const expected = `${current.slice(0, boundary).trimEnd()}\n\n${renderThemeCss(theme)}`;

    const check = process.argv.includes('--check');

    if (check && current !== expected) throw new Error('Theme CSS is stale. Run bun gen.');

    if (!check) writeFileSync(path, expected);
  } finally {
    db.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
