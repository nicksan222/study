import { dirname, relative, resolve } from 'node:path';

import { defineRule } from 'vite-plus/lint/plugins';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const marker = '/apps/server/src/';
    const index = filename.lastIndexOf(marker);

    if (index === -1) return {};

    const sourceRoot = filename.slice(0, index + marker.length);
    const current = filename.slice(index + marker.length);

    if (current !== 'index.ts' && !/^(shared|client)\//.test(current)) return {};

    function forbidden(source: string): boolean {
      if (source === '@study/db' || source.startsWith('@study/db/')) return true;

      if (/^@study\/server\/(server|runtime|procedures)(\/|$)/.test(source)) return true;

      const target = source.startsWith('#server/')
        ? resolve(sourceRoot, source.slice('#server/'.length))
        : source.startsWith('.') || source.startsWith('/')
          ? resolve(dirname(context.filename), source)
          : null;

      return (
        target !== null &&
        /^(runtime|procedures)(\/|$)/.test(relative(sourceRoot, target).replaceAll('\\', '/'))
      );
    }

    const message =
      'Shared contracts and clients must use type-only references to server runtime, procedures, and @study/db.';

    return {
      ImportDeclaration(node) {
        const typeOnly =
          node.importKind === 'type' ||
          (node.specifiers.length > 0 &&
            node.specifiers.every(
              (specifier) => specifier.type === 'ImportSpecifier' && specifier.importKind === 'type'
            ));

        if (!typeOnly && forbidden(node.source.value)) context.report({ node, message });
      },
      ExportNamedDeclaration(node) {
        const typeOnly =
          node.exportKind === 'type' ||
          (node.specifiers.length > 0 &&
            node.specifiers.every(({ exportKind }) => exportKind === 'type'));

        if (node.source && !typeOnly && forbidden(node.source.value))
          context.report({ node, message });
      },
      ExportAllDeclaration(node) {
        if (node.exportKind !== 'type' && forbidden(node.source.value))
          context.report({ node, message });
      },
      ImportExpression(node) {
        if (
          node.source.type === 'Literal' &&
          typeof node.source.value === 'string' &&
          forbidden(node.source.value)
        ) {
          context.report({ node, message });
        }
      }
    };
  }
});
