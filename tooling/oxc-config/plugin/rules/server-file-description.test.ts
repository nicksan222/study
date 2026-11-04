import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { description, framedHeader, header } from '../test/file-description.ts';
import { lintFiles, lintRule, lintRulePaths } from '../test/utils.ts';

testStable(
  'requires descriptions across server sources, tests, declarations and config only',
  () => {
    const files = {
      'apps/server/src/runtime/main.ts': 'export const value = 1;',
      'apps/server/src/features/demo/index.ts': 'export {};',
      'apps/server/test/example.test.ts': 'export {};',
      'apps/server/config.ts': 'export {};',
      'apps/server/script.mjs': 'export {};',
      'apps/server/types.d.ts': 'export {};',
      'apps/web/src/main.ts': 'export {};',
      'packages/server/src/main.ts': 'export {};',
      'packages/other/apps/server/main.ts': 'export {};'
    };

    expect(lintRulePaths('server-file-description', files)).toStrictEqual(
      Object.keys(files)
        .filter((path) => path.startsWith('apps/server/'))
        .sort()
    );
  }
);

testStable('accepts framed leading headers, licenses, shebangs, wrapping and CRLF', () => {
  expect(
    lintRule('server-file-description', {
      'src/one.ts': header + '\n\nexport {};',
      'src/license.ts': '/* Copyright Study */\n' + header + '\n\nexport {};',
      'src/cli.ts': '#!/usr/bin/env node\n' + header + '\n\nexport {};',
      'src/empty.ts': header,
      'src/packages.ts': framedHeader(
        description.replace(
          'Delegates domain behavior to feature services and owns process lifetime.',
          '@study/contracts supplies schemas while feature services own domain behavior.'
        )
      ),
      'src/windows.ts': (header + '\n\nexport {};').replaceAll('\n', '\r\n'),
      'src/wrapped.ts': framedHeader(
        description
          .replace(
            'Composes the private server runtime and feature layers.',
            'Composes the private server runtime\nand feature layers.'
          )
          .replace('with their platform dependencies.', 'with their\n  platform dependencies.')
      )
    })
  ).toStrictEqual([]);
});

testStable('rejects missing, late, nested and declaration-level descriptions', () => {
  const files = {
    'src/absent.ts': 'export {};',
    'src/declaration.ts': '/** Returns the runtime. */\nexport function runtime() {}',
    'src/late.ts': 'export {};\n' + header,
    'src/directive.ts': "'use strict';\n" + header,
    'src/nested.ts': 'export function run() {\n' + header + '\n}',
    'src/string.ts': 'export const text = ' + JSON.stringify(header) + ';',
    'src/no-code.ts': ''
  };

  const diagnostics = lintRule('server-file-description', files);

  assert.strictEqual(diagnostics.length, Object.keys(files).length, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ code }) => code === 'study(server-file-description)'));
});

testStable('requires substantive overview, responsibility bullets and boundary prose', () => {
  const invalid = [
    description.replace('Composes the private server runtime and feature layers.', ''),
    description.replace('Composes the private server runtime and feature layers.', 'Runtime.'),
    description.replace('Responsibilities:', 'Details:'),
    description.replaceAll('- ', ''),
    description.replace('Assemble feature services with their platform dependencies.', 'Assemble.'),
    description.replace('Boundaries:', 'Dependencies:'),
    description.replace(
      'Delegates domain behavior to feature services and owns process lifetime.',
      '@author Someone who wrote this module today'
    ),
    description.replace('\n\nResponsibilities:', '\nResponsibilities:'),
    description.replace('Assemble feature services', 'TODO Assemble feature services'),
    description.replace(
      'Composes the private server runtime',
      'TODO: Compose the private server runtime'
    ),
    description.replace(
      'Delegates domain behavior to feature services and owns process lifetime.',
      '- Feature services own all of the domain behavior.'
    )
  ];
  const files = Object.fromEntries(
    invalid.map((content, index) => ['src/invalid-' + index + '.ts', framedHeader(content)])
  );

  assert.strictEqual(lintRule('server-file-description', files).length, invalid.length);
});

testStable(
  'enforces frame corners, row padding, width and blank separation below the header',
  () => {
    const files = {
      'src/plain.ts': '/** @file Composes the private server runtime and feature layers. */',
      'src/corner.ts': header.replace('╭', '┌'),
      'src/line.ts': header.replace('─', '-'),
      'src/row.ts': header.replace(' * │ Responsibilities:', ' * Responsibilities:'),
      'src/padding.ts': header.replace(' * │ Responsibilities:', ' * │  Responsibilities:'),
      'src/wide.ts': framedHeader(
        description.replace(
          'Composes the private server runtime and feature layers.',
          'word '.repeat(30).trim()
        )
      ),
      'src/no-gap.ts': header + '\nexport {};',
      'src/comment-no-gap.ts': header + '\n// Another note\nexport {};'
    };

    const diagnostics = lintRule('server-file-description', files);

    assert.strictEqual(diagnostics.length, Object.keys(files).length, JSON.stringify(diagnostics));
    assert.strictEqual(
      diagnostics.filter(({ message }) => message.startsWith('Leave a blank line')).length,
      2
    );
  }
);

testStable('production lint configuration enforces the framed header', () => {
  const diagnostics = lintFiles({ 'test/undocumented.ts': 'export {};\n' });

  assert.ok(diagnostics.some(({ code }) => code === 'study(server-file-description)'));
});
