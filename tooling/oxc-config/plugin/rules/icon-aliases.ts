import { defineRule } from 'vite-plus/lint/plugins';
import type { ESTree } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';

/** Library glyphs enter the icon vocabulary through deliberate, explicit purpose aliases. */
export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!context.filename.replaceAll('\\', '/').includes('/packages/icons/src/')) return {};

    return moduleEdges(context, (node, source) => {
      if (!source || !/^lucide-react(?:\/|$)/.test(source)) return;

      const aliases =
        node.type === 'ImportDeclaration'
          ? node.specifiers.length > 0 &&
            node.specifiers.every(
              (specifier: ESTree.ImportDeclaration['specifiers'][number]) =>
                specifier.type === 'ImportSpecifier' &&
                specifier.imported.range[0] !== specifier.local.range[0]
            )
          : node.type === 'ExportNamedDeclaration' &&
            node.specifiers.length > 0 &&
            node.specifiers.every(
              (specifier: ESTree.ExportNamedDeclaration['specifiers'][number]) =>
                specifier.type === 'ExportSpecifier' &&
                specifier.local.range[0] !== specifier.exported.range[0]
            );

      if (!aliases)
        context.report({
          node,
          message:
            'Give every library icon an explicit purpose alias with `as` (for example, FileText as NoteIcon). Avoid namespace, wildcard and dynamic access.'
        });
    });
  }
});
