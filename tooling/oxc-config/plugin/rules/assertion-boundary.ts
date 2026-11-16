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

function testRunnerConfigOwner(filename: string): boolean {
  return (
    (filename.endsWith('/vite.config.ts') && !/\/(?:apps|packages|tooling)\//.test(filename)) ||
    filename.endsWith('/apps/client/playwright.config.ts')
  );
}

function testRunnerOwner(filename: string): boolean {
  return (
    filename.includes('/packages/testing/src/') ||
    filename.includes('/tooling/testing/') ||
    filename.includes('/tooling/oxc-config/') ||
    testRunnerConfigOwner(filename)
  );
}

function testRunnerSource(source: string | null): boolean {
  return (
    source !== null &&
    /^(?:vitest|vite-plus\/test|bun:test|@study\/testing(?:\/vitest)?)$/.test(source)
  );
}

function runnerImport(
  filename: string,
  test: boolean,
  typeOnly: boolean,
  source: string | null
): boolean {
  return !test && !typeOnly && !testRunnerOwner(filename) && testRunnerSource(source);
}

function checkImport(
  context: any,
  filename: string,
  test: boolean,
  node: any,
  source: string | null,
  typeOnly: boolean
): void {
  if (source && /^(?:node:)?assert(?:\/strict)?$/.test(source))
    context.report({ node, message: 'Use test runner assertions instead of node:assert.' });
  else if (runnerImport(filename, test, typeOnly, source))
    context.report({ node, message: 'Test runners must not be imported by production modules.' });
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const test = /\.(?:test|spec)\.[cm]?[jt]sx?$|\/(?:test|tests)\//.test(filename);

    return moduleEdges(context, (node, source, typeOnly) =>
      checkImport(context, filename, test, node, source, typeOnly)
    );
  }
});
