import { existsSync } from 'node:fs';

import { defineRule } from 'vite-plus/lint/plugins';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (
      !filename.includes('/packages/backend/src/procedures/') ||
      !filename.endsWith('.ts') ||
      filename.endsWith('.test.ts')
    )
      return {};

    return {
      ExportNamedDeclaration(node) {
        if (node.exportKind === 'type') return;

        const declaration = node.declaration;
        const exportsRun =
          declaration?.type === 'VariableDeclaration'
            ? declaration.declarations.some(
                ({ id }) => id.type === 'Identifier' && id.name === 'run'
              )
            : declaration?.type === 'FunctionDeclaration'
              ? declaration.id?.name === 'run'
              : node.specifiers.some(
                  ({ exported, exportKind }) =>
                    exportKind !== 'type' &&
                    (exported.type === 'Identifier' ? exported.name : exported.value) === 'run'
                );

        if (exportsRun && !existsSync(context.filename.replace(/\.ts$/, '.test.ts'))) {
          context.report({
            node,
            message: 'A procedure exporting run must have a sibling .test.ts file.'
          });
        }
      }
    };
  }
});
