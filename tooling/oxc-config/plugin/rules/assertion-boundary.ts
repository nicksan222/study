/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Keeps assertions on test-runner APIs and test runners out of production modules.   │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Imports, reexports and loader edges to assert/node:assert, including strict variants, in │
 * │ any file. Runtime imports of supported test runners/wrappers are limited to test/spec    │
 * │ files, test/tests folders and the shared testing owners; type-only imports are           │
 * │ allowed.                                                                                 │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   // apps/server/test/example.test.ts                                                    │
 * │   import { expect } from 'vite-plus/test';                                               │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   import assert from 'node:assert/strict';                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const test = /\.(?:test|spec)\.[cm]?[jt]sx?$|\/(?:test|tests)\//.test(filename);

    return moduleEdges(context, (node, source, typeOnly) => {
      if (source && /^(?:node:)?assert(?:\/strict)?$/.test(source))
        context.report({ node, message: 'Use test runner assertions instead of node:assert.' });
      else if (
        !test &&
        !filename.includes('/packages/testing/src/') &&
        !filename.includes('/tooling/testing/') &&
        !typeOnly &&
        source &&
        /^(?:vitest|vite-plus\/test|bun:test|@study\/testing\/vitest)$/.test(source)
      )
        context.report({
          node,
          message: 'Test runners must not be imported by production modules.'
        });
    });
  }
});
