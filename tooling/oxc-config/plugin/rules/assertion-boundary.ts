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
        !filename.endsWith('/packages/testing/src/vitest.ts') &&
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
