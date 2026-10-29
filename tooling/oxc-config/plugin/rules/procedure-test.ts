import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { defineRule } from 'vite-plus/lint/plugins';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const inProcedures = filename.includes('/apps/server/src/procedures/');
    const testFile = inProcedures && filename.endsWith('.test.ts');
    const deprecatedTestApi =
      'Procedure tests must use createServerTest(t); fixture, caller and testDatabase setup APIs are forbidden.';
    const namespaceImports = new Map<string, { blocked: Set<string>; specifier: any }>();

    if (!inProcedures || !filename.endsWith('.ts')) return {};

    function procedureTestPath(): string {
      return filename.endsWith('/procedure.ts') || filename.endsWith('/index.ts')
        ? join(dirname(context.filename), 'procedure.test.ts')
        : context.filename.replace(/\.ts$/, '.test.ts');
    }

    function blockedNames(source: string): Set<string> | undefined {
      return source === '@study/db/testing'
        ? new Set(['createTestDatabase'])
        : source === '#testing/procedures' || source === '#testing/automatic'
          ? new Set(['fixture', 'caller', 'testDatabase'])
          : undefined;
    }

    function isImportedBinding(node: any, specifier: any): boolean {
      let scope = context.sourceCode.getScope(node);

      while (scope) {
        const variable = scope.set.get(node.name);

        if (variable) return variable.defs.some((definition) => definition.node === specifier);

        scope = scope.upper!;
      }

      return false;
    }

    return {
      ImportDeclaration(node) {
        if (!testFile) return;

        if (node.importKind === 'type') return;

        const blocked = blockedNames(node.source.value);

        if (!blocked) return;

        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') {
            namespaceImports.set(specifier.local.name, { blocked, specifier });
            continue;
          }

          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.importKind !== 'type' &&
            specifier.imported.type === 'Identifier' &&
            blocked.has(specifier.imported.name)
          )
            context.report({ node: specifier, message: deprecatedTestApi });
        }
      },
      ExportNamedDeclaration(node) {
        if (testFile && node.source && node.exportKind !== 'type') {
          const blocked = blockedNames(node.source.value);

          if (blocked)
            for (const specifier of node.specifiers) {
              const name =
                specifier.local.type === 'Identifier'
                  ? specifier.local.name
                  : specifier.local.value;

              if (specifier.exportKind !== 'type' && blocked.has(name))
                context.report({ node: specifier, message: deprecatedTestApi });
            }
        }

        if (!inProcedures || testFile || node.exportKind === 'type') return;

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

        if (exportsRun && !existsSync(procedureTestPath())) {
          context.report({
            node,
            message:
              filename.endsWith('/procedure.ts') || filename.endsWith('/index.ts')
                ? 'A folder procedure must have a sibling procedure.test.ts file.'
                : 'A procedure exporting run must have a sibling .test.ts file.'
          });
        }
      },
      ExportAllDeclaration(node) {
        if (testFile && blockedNames(node.source.value))
          context.report({ node, message: deprecatedTestApi });
      },
      MemberExpression(node) {
        if (!testFile || node.object.type !== 'Identifier') return;

        const binding = namespaceImports.get(node.object.name);
        const property = node.computed
          ? node.property.type === 'Literal' && typeof node.property.value === 'string'
            ? node.property.value
            : undefined
          : node.property.type === 'Identifier'
            ? node.property.name
            : undefined;

        if (
          binding &&
          property &&
          binding.blocked.has(property) &&
          isImportedBinding(node.object, binding.specifier)
        )
          context.report({ node, message: deprecatedTestApi });
      }
    };
  }
});
