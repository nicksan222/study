import { test } from '@study/testing';

import { lintFiles, lintRulePaths } from '../test/utils.ts';

const directory = 'tooling/oxc-config/plugin/rules';

const implementation = `import { defineRule } from 'vite-plus/lint/plugins';

export default defineRule({ create() { return {}; } });
`;

const contents = `@file Keeps feature imports on their public boundaries.

Prevents:
Direct imports of another feature's private store.

Allowed:
  import { Materials } from '#server/features/materials';

Rejected:
  import { store } from '#server/features/materials/store';`;

function frame(contents: string): string {
  return [
    '/**',
    ' * ╭' + '─'.repeat(90) + '╮',
    ...contents.split('\n').map((line) => ' * │ ' + line.padEnd(88) + ' │'),
    ' * ╰' + '─'.repeat(90) + '╯',
    ' */'
  ].join('\n');
}

const guide = frame(contents);

test.unit.stable(
  'production config rejects undocumented custom lint implementations',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintFiles(
      { assert },
      { [`${directory}/missing.ts`]: implementation },
      undefined,
      true
    );

    assert.ok(diagnostics.some(({ code }) => code === 'study(lint-rule-description)'));
  }
);

test.unit.stable(
  'requires a purpose, prevented failure and both examples before imports',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const variants = {
      missing: '',
      'purpose-only': '@file Checks imports.',
      'empty-purpose': contents.replace(
        '@file Keeps feature imports on their public boundaries.',
        '@file'
      ),
      'empty-prevention': contents.replace(
        "Direct imports of another feature's private store.",
        ''
      ),
      'missing-allowed': contents.replace('Allowed:', 'Accepted:'),
      'empty-allowed': contents.replace(
        "  import { Materials } from '#server/features/materials';",
        ''
      ),
      'missing-rejected': contents.replace('Rejected:', 'Incorrect:'),
      'empty-rejected': contents.replace(
        "  import { store } from '#server/features/materials/store';",
        ''
      )
    };
    const files = Object.fromEntries(
      Object.entries(variants).map(([name, header]) => [
        `${directory}/${name}.ts`,
        `${frame(header)}\n\n${implementation}`
      ])
    );

    files[`${directory}/late.ts`] = implementation + guide;
    files[`${directory}/split.ts`] =
      `/** @file Checks imports. */\n${frame(contents.replace('@file Keeps feature imports on their public boundaries.', ''))}\n${implementation}`;

    expect(await lintRulePaths({ assert }, 'lint-rule-description', files)).toStrictEqual(
      Object.keys(files).sort()
    );
  }
);

test.unit.stable(
  'allows framed guides, licenses, CRLF and helpers without a lint implementation',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lintRulePaths({ assert }, 'lint-rule-description', {
        [`${directory}/documented.ts`]: `${guide}\n\n${implementation}`,
        [`${directory}/license.ts`]: `/* Copyright Study */\n${guide}\n\n${implementation}`,
        [`${directory}/windows.ts`]: `${guide}\n\n${implementation}`.replaceAll('\n', '\r\n'),
        [`${directory}/helper.ts`]: 'export function helper() { return 1; }',
        [`${directory}/example.test.ts`]: implementation,
        [`${directory}/example.spec.ts`]: implementation,
        'apps/server/src/example.ts': implementation,
        [`${directory}/unrelated.ts`]:
          'function defineRule(value) { return value; } export default defineRule({});'
      })
    ).toStrictEqual([]);
  }
);

test.unit.stable(
  'recognizes imported aliases and namespaces without confusing shadowed bindings',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lintRulePaths({ assert }, 'lint-rule-description', {
        [`${directory}/alias.ts`]:
          "import { defineRule as rule } from 'vite-plus/lint/plugins'; export default rule({});",
        [`${directory}/namespace.ts`]:
          "import * as lint from 'vite-plus/lint/plugins'; export default lint.defineRule({});",
        [`${directory}/shadowed.ts`]: `import { defineRule } from 'vite-plus/lint/plugins';
 function make(defineRule) { return defineRule({});
 }`
      })
    ).toStrictEqual([`${directory}/alias.ts`, `${directory}/namespace.ts`]);
  }
);

test.unit.stable(
  'requires the padded frame around rule explanations',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const variants = {
      plain:
        '/**\n' +
        contents
          .split('\n')
          .map((line) => ' * ' + line)
          .join('\n') +
        '\n */',
      corner: guide.replace('╭', '┌'),
      border: guide.replace('─', '-'),
      padding: guide.replace(' * │ Prevents:', ' * │  Prevents:'),
      width: frame(contents + '\n' + 'x'.repeat(89))
    };
    const files = Object.fromEntries(
      Object.entries(variants).map(([name, header]) => [
        `${directory}/${name}.ts`,
        `${header}\n\n${implementation}`
      ])
    );

    expect(await lintRulePaths({ assert }, 'lint-rule-description', files)).toStrictEqual(
      Object.keys(files).sort()
    );
  }
);
