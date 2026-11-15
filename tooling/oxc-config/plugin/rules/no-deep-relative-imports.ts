/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Replace imports climbing multiple parent levels with aliases.                      │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Prevents module edges from depending on distant directory structure. Counts normalized   │
 * │ parent traversal across imports, exports and recognized loaders.                         │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   import './reads.ts';                                                                   │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   import '../../platform/database/context.ts';                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    return moduleEdges(context, (node, source) => {
      if (source === null || !source.startsWith('.')) return;

      const normalized = source.replaceAll('\\', '/');
      let depth = 0;
      let descendants = 0;

      for (const part of normalized.split('/')) {
        if (part === '..') {
          if (descendants > 0) descendants--;
          else depth++;
        } else if (part && part !== '.') descendants++;
      }

      if (depth >= 2)
        context.report({
          node,
          message: 'Define a package import alias instead of traversing two or more parent levels.'
        });
    });
  }
});
