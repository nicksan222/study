import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { header } from '../test/file-description.ts';
import { lintFiles, lintRule, lintRulePaths } from '../test/utils.ts';

testStable('requires purpose comments only in server production modules', async () => {
  expect(
    await lintRulePaths('server-file-description', {
      'apps/server/src/runtime/main.ts': 'export const value = 1;',
      'apps/server/src/features/demo/index.ts': 'export {};',
      'apps/server/src/example.test.ts': 'export {};',
      'apps/server/src/example.spec.ts': 'export {};',
      'apps/server/src/types.d.ts': 'export {};',
      'apps/server/test/example.test.ts': 'export {};',
      'apps/server/config.ts': 'export {};',
      'apps/client/src/main.ts': 'export {};',
      'packages/other/apps/server/src/main.ts': 'export {};'
    })
  ).toStrictEqual(['apps/server/src/features/demo/index.ts', 'apps/server/src/runtime/main.ts']);
});

testStable(
  'accepts concise purpose comments without framing, quotas or section templates',
  async () => {
    expect(
      await lintRule('server-file-description', {
        'src/plain.ts': '/** @file Composes runtime layers. */\nexport {};',
        'src/license.ts': '/* Copyright Study */\n/** @file Starts the server. */\nexport {};',
        'src/cli.ts': '#!/usr/bin/env bun\n/** @file Starts the server. */\nexport {};',
        'src/multiline.ts':
          '/**\n * @file Composes runtime layers\n * and owns their lifetime.\n */\nexport {};',
        'src/windows.ts': '/** @file Starts the server. */\r\nexport {};',
        'src/framed.ts':
          '/**\n * ╭──────────────────────────────────╮\n * │ @file Composes runtime layers.   │\n * ╰──────────────────────────────────╯\n */\n\nexport {};'
      })
    ).toStrictEqual([]);
  }
);

testStable('rejects absent, empty, placeholder, late and nested purpose comments', async () => {
  const files = {
    'src/absent.ts': 'export {};',
    'src/empty.ts': '/** @file */\nexport {};',
    'src/placeholder.ts': '/** @file TODO */\nexport {};',
    'src/tag-only.ts': '/** @file\n * @author Someone\n */\nexport {};',
    'src/declaration.ts': '/** Returns the runtime. */\nexport function runtime() {}',
    'src/late.ts': 'export {};\n' + header,
    'src/nested.ts': 'export function run() {\n' + header + '\n}',
    'src/string.ts': 'export const text = ' + JSON.stringify(header) + ';'
  };
  const diagnostics = await lintRule('server-file-description', files);

  assert.strictEqual(diagnostics.length, Object.keys(files).length, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ code }) => code === 'study(server-file-description)'));
});

testStable('production config accepts plain purpose comments and exempts tests', async () => {
  const diagnostics = await lintFiles({
    'src/shared/purpose.ts': '/** @file Exposes the shared value. */\n\nexport const value = 1;\n',
    'test/undocumented.ts': 'export {};\n'
  });

  assert.ok(!diagnostics.some(({ code }) => code === 'study(server-file-description)'));
});
