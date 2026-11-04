import { readFileSync } from 'node:fs';

import { testStable } from '@study/testing/vitest';
import { parseTheme, themeColorKeys } from '@study/theme';
import { and, eq } from 'drizzle-orm';
import { assert, expect } from 'vite-plus/test';

import { themes, preferences } from '../src/schema.ts';
import { createTestDatabase } from '../src/testing.ts';

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

testStable(
  'the curated catalog includes complete accessible light and dark palettes without T3 Chat',
  () => {
    const location = createTestDatabase();
    const db = location.open();

    try {
      const catalog = db.orm.select().from(themes).all();

      assert.ok(!catalog.some((theme) => theme.id === 't3-chat'));

      for (const id of ['tokyo-night', 'catppuccin', 'rose-pine', 'nord']) {
        const row = catalog.find((theme) => theme.id === id);

        assert.ok(row?.builtin, id);
        const theme = parseTheme(JSON.stringify(row.definition));

        for (const mode of ['light', 'dark'] as const) {
          const colors = theme[mode]!;

          expect(Object.keys(colors).sort(), `${id} ${mode}`).toStrictEqual(
            [...themeColorKeys].sort()
          );

          verifyContrast(colors, id, mode);
        }
      }
    } finally {
      db.close();
      location.cleanup();
    }
  }
);

testStable('upgrading retires T3 Chat while preserving custom themes and their identities', () => {
  const location = createTestDatabase();
  const before = location.open();
  const original = before.orm
    .select()
    .from(themes)
    .where(eq(themes.id, 't3-code'))
    .get()!.definition;

  try {
    // Replay the data-only migration over the previous catalog and a user-owned name collision.
    before.orm
      .insert(themes)
      .values({
        id: 't3-chat',
        definition: { ...original, id: 't3-chat', name: 'T3 Chat' },
        builtin: true
      })
      .run();
    before.orm
      .insert(preferences)
      .values({ scope: 'theme', key: 'selected', value: JSON.stringify('t3-chat') })
      .run();
    before.orm.delete(themes).where(eq(themes.id, 'catppuccin')).run();
    before.orm
      .insert(themes)
      .values({
        id: 'catppuccin',
        builtin: false,
        definition: {
          version: 1,
          id: 'catppuccin',
          name: 'My custom palette',
          dark: { primary: '#abcdef' }
        }
      })
      .run();
    before.exec(
      readFileSync(
        new URL('../drizzle/20261101115116_curated-theme-palettes/migration.sql', import.meta.url),
        'utf8'
      )
    );
  } finally {
    before.close();
  }

  const db = location.open();

  try {
    const selected = db.orm
      .select()
      .from(preferences)
      .where(and(eq(preferences.scope, 'theme'), eq(preferences.key, 'selected')))
      .get();
    const custom = db.orm.select().from(themes).where(eq(themes.id, 'catppuccin')).get();

    assert.strictEqual(selected?.value, JSON.stringify('tokyo-night'));
    assert.strictEqual(custom?.definition.name, 'My custom palette');
    assert.strictEqual(custom?.builtin, false);
    assert.ok(
      !db.orm
        .select()
        .from(themes)
        .all()
        .some((theme) => theme.id === 't3-chat')
    );
  } finally {
    db.close();
    location.cleanup();
  }
});

function verifyContrast(
  colors: NonNullable<ReturnType<typeof parseTheme>['light']>,
  id: string,
  mode: string
) {
  for (const [foreground, background] of [
    ['foreground', 'background'],
    ['muted-foreground', 'background'],
    ['sidebar-foreground', 'sidebar'],
    ['sidebar-muted-foreground', 'sidebar'],
    ['primary-foreground', 'primary'],
    ['card-foreground', 'card'],
    ['popover-foreground', 'popover'],
    ['error-foreground', 'error-surface'],
    ['warning-foreground', 'warning-surface'],
    ['message-foreground', 'message-surface'],
    ['message-action-foreground', 'message-action'],
    ['toolbar-foreground', 'toolbar-background'],
    ['code-foreground', 'code-background'],
    ['terminal-foreground', 'terminal-background'],
    ['control-on-destructive', 'destructive']
  ] as const)
    assert.ok(
      contrast(colors[foreground]!, colors[background]!) >= 4.5,
      `${id} ${mode} ${foreground}`
    );
}
