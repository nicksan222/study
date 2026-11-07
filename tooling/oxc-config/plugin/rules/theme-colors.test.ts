import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';
import { hasRawColor, hasRawColorClass, cssColorViolations } from '../theme-color-values.ts';

testStable('raw CSS colors are rejected but semantic colors and ordinary words are allowed', () => {
  for (const value of [
    '#abc',
    '#12345678',
    'rgb(1 2 3)',
    'hsl(0 0% 50%)',
    'oklch(50% 0 0)',
    'rebeccapurple',
    'darkslateblue'
  ])
    assert.strictEqual(hasRawColor(value), true, value);

  for (const value of [
    'var(--background)',
    'currentColor',
    'transparent',
    'color-mix(in srgb, var(--foreground), transparent)',
    'blueprint'
  ])
    assert.strictEqual(hasRawColor(value), false, value);
});

testStable(
  'raw Tailwind palette and arbitrary colors are rejected without matching semantic classes',
  () => {
    for (const value of [
      'hover:bg-red-500/20',
      'text-white',
      'border-[#abc]',
      'fill-[rgb(1,2,3)]',
      'shadow-[0_1px_--theme(--color-black/4%)]',
      'border-t-red-500',
      'ring-offset-white',
      '!bg-white',
      'bg-white!',
      'inset-shadow-black',
      '[color:red]'
    ])
      assert.strictEqual(hasRawColorClass(value), true, value);

    for (const value of [
      'bg-background text-foreground',
      'border-transparent',
      'text-current',
      'bg-[var(--background)]'
    ])
      assert.strictEqual(hasRawColorClass(value), false, value);
  }
);

testStable('CSS checks declarations while ignoring comments and non-color text', () => {
  const violations = cssColorViolations(
    '/* color: #abc; */ .x { color: red; background: var(--background); box-shadow: 0 1px rgb(0 0 0 / 20%); content: "blue"; }'
  );

  assert.strictEqual(violations.length, 2);
});

testStable(
  'theme colors rule detects raw JSX styles and palette classes without flagging prose or semantic utilities',
  () => {
    const diagnostics = lintRule(
      'theme-colors',
      {
        'apps/web/src/colors.tsx': `export const view = <div className="bg-background text-foreground"><p className="hover:border-t-red-500" style={{ color: "darkslateblue" }}>A blue sky</p><div className="[color:#abc]" /><div style={{ backgroundImage: "linear-gradient(red, blue)", "color": "red" }} /></div>;`
      },
      true
    );
    const violations = diagnostics.filter(({ code }) => code.includes('theme-colors'));

    assert.strictEqual(violations.length, 5, JSON.stringify(diagnostics));
  }
);

testStable('theme colors rule covers template values, SVG fills and named arbitrary colors', () => {
  const diagnostics = lintRule(
    'theme-colors',
    {
      'apps/web/src/templates.tsx':
        'export const view = <div style={{ color: `red`, "background-image": `linear-gradient(red, blue)` }}><svg fill={"red"} /><div className="border-t-[red] inset-shadow-[0_1px_red] [background-image:linear-gradient(red,_blue)]" /></div>;'
    },
    true
  );

  assert.strictEqual(
    diagnostics.filter(({ code }) => code.includes('theme-colors')).length,
    4,
    JSON.stringify(diagnostics)
  );
});

testStable(
  'shared feature previews retain semantic app colors while landing art stays independent',
  () => {
    const diagnostics = lintRule(
      'theme-colors',
      {
        'apps/web/src/feature-previews/index.tsx':
          'export const view = <div className="bg-stone-50" style={{ color: "#abc" }} />;',
        'apps/web/src/feature-previews/semantic.tsx':
          'export const view = <div className="bg-background text-foreground" />;',
        'apps/landing/src/components/Notebook.tsx':
          'export const view = <div style={{ color: "#abc" }} />;'
      },
      true
    );

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
    assert.ok(
      diagnostics.every(({ filename }) => filename.endsWith('/feature-previews/index.tsx'))
    );
  }
);
