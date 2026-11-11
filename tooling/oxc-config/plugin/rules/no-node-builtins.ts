import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    return moduleEdges(context, (node, source) => {
      if (!source) return;

      let builtin = source.startsWith('node:');

      if (!builtin && !source.startsWith('.') && !source.startsWith('/')) {
        try {
          builtin = Bun.resolveSync(source, import.meta.dir).startsWith('node:');
        } catch {
          // Unresolved packages are handled by the module resolver.
        }
      }

      if (builtin)
        context.report({ node, message: 'Use Bun, Web, or Effect APIs instead of Node builtins.' });
    });
  }
});
