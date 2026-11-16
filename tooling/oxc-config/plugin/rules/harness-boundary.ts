/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Separate production dependencies from owned server test resource acquisition.      │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Prevents production server modules from importing the test harness, and server test/spec │
 * │ files from opening imported Db or App directly. Shared test/testing harness modules may  │
 * │ own acquisition.                                                                         │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   // apps/server/src/features/notes/service.test.ts                                      │
 * │   import { createServerTest } from '#testing/server-test';                               │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   // apps/server/src/features/notes/service.test.ts                                      │
 * │   import { Db } from '@study/db';                                                        │
 * │   Db.open(':memory:');                                                                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { importedValue, moduleEdges, serverPath } from '../architecture-imports.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const path = context.filename.replaceAll('\\', '/');
    const current = serverPath(path);
    const serverTest = /\/apps\/server\//.test(path) && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
    const production = current !== null && !serverTest;
    const edges = moduleEdges(context, (node, source) => {
      if (
        production &&
        source &&
        (/^#testing(?:\/|$)|^@study\/server\/testing$/.test(source) ||
          /(?:^|\/)test\/testing(?:\/|$)/.test(source))
      )
        context.report({ node, message: 'Production modules cannot depend on the test harness.' });
    });

    function resourceAcquisition(node: any): boolean {
      const value = importedValue(context, node);

      if (!value) return false;

      if (value.source === '@study/db' && value.name === 'Db.open') return true;

      return (
        value.name === 'App.open' &&
        (value.source === '@study/server/runtime' ||
          value.target === 'runtime/index' ||
          value.target === 'runtime/service')
      );
    }

    return {
      ...edges,
      CallExpression(node: any) {
        edges.CallExpression(node);

        if (serverTest && resourceAcquisition(node.callee))
          context.report({
            node,
            message: 'Acquire application and database resources through the server test harness.'
          });
      }
    };
  }
});
