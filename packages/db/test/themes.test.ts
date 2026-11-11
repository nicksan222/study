import { testStable } from '@study/testing/vitest';
import { parseTheme, themeColorKeys } from '@study/theme';
import { assert, expect } from 'vite-plus/test';

import { themes } from '../src/schema.ts';
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
  async () => {
    const location = await createTestDatabase();
    const db = await location.open();

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
      await location.cleanup();
    }
  }
);

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
