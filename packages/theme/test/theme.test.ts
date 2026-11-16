import { test } from '@study/testing';

import {
  parseTheme,
  serializeTheme,
  ThemeFileError,
  themeColorKeys,
  renderThemeCss
} from '../src/index.ts';

test.stable('portable themes round trip and reject unsafe or unknown data', () => {
  const theme = {
    version: 1 as const,
    id: 'ocean',
    name: 'Ocean',
    colors: { primary: '#123456' },
    dark: { primary: 'rgb(1, 2, 3)' }
  };

  test.expect(parseTheme(serializeTheme(theme))).toStrictEqual(theme);

  for (const input of [
    '{',
    'null',
    '{}',
    JSON.stringify({ ...theme, version: 2 }),
    JSON.stringify({ ...theme, colors: { unknown: 'red' } }),
    JSON.stringify({ ...theme, colors: { primary: 'red; color: blue' } }),
    JSON.stringify({ ...theme, colors: { primary: 'garbage' } }),
    JSON.stringify({ ...theme, colors: { primary: 'rgb(foo)' } }),
    JSON.stringify({ ...theme, id: '' }),
    JSON.stringify({ ...theme, extra: true }),
    '{"version":1,"id":"x","name":"X","colors":{"__proto__":"red"}}'
  ])
    test.assert.throws(() => parseTheme(input));
});

test.stable('normalizes metadata and accepts supported CSS color spaces in every variant', () => {
  for (const color of [
    '#abc',
    '#12345678',
    'rebeccapurple',
    'rgb(1 2 3 / 50%)',
    'hsl(120 50% 50%)',
    'oklch(60% 0.1 120)',
    'color(display-p3 1 0 0)'
  ]) {
    const parsed = parseTheme(
      JSON.stringify({
        version: 1,
        id: 'theme_1.dark',
        name: '  Tema è bello  ',
        colors: { primary: ` ${color} ` },
        light: { background: color },
        dark: { foreground: color }
      })
    );

    test.assert.strictEqual(parsed.name, 'Tema è bello');
    test.assert.strictEqual(parsed.colors?.primary, color);
    test.assert.strictEqual(parsed.light?.background, color);
    test.assert.strictEqual(parsed.dark?.foreground, color);
  }
});

test.stable(
  'rejects invalid containers, metadata, palettes, and context-dependent colors with a typed error',
  () => {
    const base = { version: 1, id: 'valid', name: 'Valid' };
    const invalid = [
      [],
      true,
      1,
      'theme',
      { ...base, id: '_invalid' },
      { ...base, id: 'a'.repeat(129) },
      { ...base, name: ' ' },
      { ...base, name: 'a'.repeat(129) },
      { ...base, name: 'bad\nname' },
      { ...base, name: 1 },
      { ...base, colors: null },
      { ...base, light: [] },
      { ...base, dark: 'red' },
      { ...base, colors: { primary: 1 } },
      { ...base, colors: { primary: '' } }
    ];

    for (const value of invalid)
      test.assert.throws(() => parseTheme(JSON.stringify(value)), ThemeFileError);

    for (const color of [
      'currentColor',
      'var(--primary)',
      'url(https://example.com)',
      'red !important',
      'rgb(1 2 3); color: red',
      'red blue'
    ]) {
      test.assert.throws(
        () => parseTheme(JSON.stringify({ ...base, colors: { primary: color } })),
        ThemeFileError
      );
    }

    test.assert.throws(() => parseTheme(' '.repeat(65537)), ThemeFileError);
  }
);

test.stable(
  'accepts boundary metadata and payload sizes and every registered semantic color role',
  () => {
    const colors = Object.fromEntries(themeColorKeys.map((key) => [key, '#123456']));
    const file = { version: 1 as const, id: 'a'.repeat(128), name: 'A'.repeat(128), colors };
    const json = JSON.stringify(file);

    test.expect(parseTheme(json.padEnd(65536, ' '))).toStrictEqual(file);
    test.assert.throws(() => parseTheme(json.padEnd(65537, ' ')), ThemeFileError);
  }
);

test.stable('export validates, normalizes and round trips without mutating its input', () => {
  const file = {
    version: 1 as const,
    id: 'export',
    name: '  Export  ',
    colors: { primary: '  #abc  ' },
    light: {},
    dark: { background: 'black' }
  };
  const before = JSON.stringify(file);
  const exported = serializeTheme(file);

  test.assert.strictEqual(JSON.stringify(file), before);
  test.assert.strictEqual(serializeTheme(parseTheme(exported)), exported);
  test.assert.strictEqual(parseTheme(exported).name, 'Export');
  test.assert.throws(
    () => serializeTheme({ ...file, colors: { primary: 'not-a-color' } }),
    ThemeFileError
  );
});

test.stable('CSS rendering merges common colors before each appearance override', () => {
  const css = renderThemeCss({
    version: 1,
    id: 'css',
    name: 'CSS',
    colors: { primary: 'red', foreground: 'white' },
    light: { primary: 'blue' },
    dark: { background: 'black' }
  });

  test.expect(css).toMatch(/:root \{\n  --primary: blue;\n  --foreground: white;/);
  test
    .expect(css)
    .toMatch(/:root\.dark \{\n  --primary: red;\n  --foreground: white;\n  --background: black;/);
});
