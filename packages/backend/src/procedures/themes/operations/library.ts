import { themes } from '@study/db/schema';
import { parseTheme, serializeTheme, ThemeFileError } from '@study/theme';
import { eq, sql } from 'drizzle-orm';

import { loadPreferences, setPreference } from '#backend/procedures/settings/preferences';
import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';

export function parse(json: string) {
  try {
    return parseTheme(json);
  } catch (error) {
    if (error instanceof ThemeFileError)
      throw new StudyError('invalid_input', 'invalid theme file');

    throw error;
  }
}

export function find(ctx: BackendContext, id: string) {
  return ctx.db.orm.select().from(themes).where(eq(themes.id, id)).get()?.definition;
}

export function required(ctx: BackendContext, id: string) {
  const theme = find(ctx, id);

  if (!theme) throw new StudyError('not_found', 'theme not found');

  return theme;
}

export function selected(ctx: BackendContext): string | null {
  const id = loadPreferences(ctx, 'theme').selected;

  return typeof id === 'string' ? id : null;
}

export function select(ctx: BackendContext, id: string | null) {
  ctx.transaction(() => {
    if (id !== null) required(ctx, id);

    setPreference(ctx, 'theme', 'selected', id);
  });
}

export function save(ctx: BackendContext, json: string, replace: boolean) {
  const theme = parse(json);

  const insert = ctx.db.orm.insert(themes).values({ id: theme.id, definition: theme });
  const saved = replace
    ? insert
        .onConflictDoUpdate({
          target: themes.id,
          set: { definition: theme },
          setWhere: sql`${themes.builtin} = 0`
        })
        .returning()
        .get()
    : insert.onConflictDoNothing({ target: themes.id }).returning().get();

  if (!saved) throw new StudyError('invalid_input', 'theme already exists');

  return theme;
}

export function remove(ctx: BackendContext, id: string) {
  ctx.transaction(() => {
    const row = ctx.db.orm.select().from(themes).where(eq(themes.id, id)).get();

    if (!row) throw new StudyError('not_found', 'theme not found');

    if (row.builtin) throw new StudyError('invalid_input', 'built-in theme is read-only');

    ctx.db.orm.delete(themes).where(eq(themes.id, id)).run();

    if (selected(ctx) === id) select(ctx, null);
  });
}

export function exportFile(ctx: BackendContext, id: string) {
  return serializeTheme(required(ctx, id));
}
