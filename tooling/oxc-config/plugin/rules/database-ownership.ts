import type { ESTree } from 'vite-plus/lint/plugins';
import { defineRule } from 'vite-plus/lint/plugins';

const factories = new Set(['sqliteTable', 'sqliteTableCreator', 'sqliteView', 'view']);

const connectionMessage = 'SQLite connections and migrations belong in packages/db/src/db.ts.';

const schemaMessage = 'SQLite schema factories belong in packages/db/src/schema/.';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const connectionOwner = filename.endsWith('/packages/db/src/db.ts');
    const schemaOwner = /\/packages\/db\/src\/schema\/.+\.[cm]?[jt]sx?$/.test(filename);

    const migrators = new Set(['migrateSync', 'migrateAsync']);
    const ownedImports = new Map<string, 'connection' | 'schema'>();

    function kind(source: string, exports = false): 'connection' | 'schema' | null {
      if (source === 'node:sqlite' || /^drizzle-orm\/node-sqlite(?:\/|$)/.test(source))
        return connectionOwner && !exports ? null : 'connection';

      if (source === 'drizzle-orm/sqlite-core' || source.startsWith('drizzle-orm/sqlite-core/'))
        return schemaOwner && !exports ? null : 'schema';

      return null;
    }

    function registerImports(node: ESTree.ImportDeclaration) {
      const restricted = kind(node.source.value);
      const ownerKind = kind(node.source.value, true);

      if (!ownerKind || node.importKind === 'type') return;

      for (const specifier of node.specifiers) {
        if (specifier.type !== 'ImportSpecifier') {
          if (!restricted) ownedImports.set(specifier.local.name, ownerKind);

          continue;
        }

        if (specifier.importKind === 'type') continue;

        const imported =
          specifier.imported.type === 'Identifier'
            ? specifier.imported.name
            : specifier.imported.value;

        if (connectionOwner && ownerKind === 'schema' && migrators.has(imported))
          ownedImports.set(specifier.local.name, 'connection');
        else if (!restricted && (ownerKind === 'connection' || factories.has(imported)))
          ownedImports.set(specifier.local.name, ownerKind);
      }
    }

    return {
      Program(program) {
        for (const node of program.body)
          if (node.type === 'ImportDeclaration') registerImports(node);
      },
      ImportDeclaration(node) {
        const restricted = kind(node.source.value);
        const ownerKind = kind(node.source.value, true);

        if (node.importKind === 'type') return;

        if (
          !connectionOwner &&
          ownerKind === 'schema' &&
          node.specifiers.some(
            (s) =>
              s.type === 'ImportSpecifier' &&
              s.importKind !== 'type' &&
              migrators.has(s.imported.type === 'Identifier' ? s.imported.name : s.imported.value)
          )
        ) {
          context.report({ node, message: connectionMessage });

          return;
        }

        if (
          schemaOwner &&
          ownerKind === 'schema' &&
          node.specifiers.some((s) => s.type !== 'ImportSpecifier')
        ) {
          context.report({ node, message: connectionMessage });

          return;
        }

        if (!restricted) return;

        if (restricted === 'connection') {
          if (
            node.specifiers.length === 0 ||
            node.specifiers.some((s) => s.type !== 'ImportSpecifier' || s.importKind !== 'type')
          )
            context.report({ node, message: connectionMessage });
        } else if (
          node.specifiers.some(
            (s) =>
              s.type !== 'ImportSpecifier' ||
              (s.importKind !== 'type' &&
                factories.has(
                  s.imported.type === 'Identifier' ? s.imported.name : s.imported.value
                ))
          )
        ) {
          context.report({ node, message: schemaMessage });
        }
      },
      ExportNamedDeclaration(node) {
        if (node.exportKind === 'type') return;

        if (!node.source) {
          for (const specifier of node.specifiers) {
            if (specifier.exportKind === 'type') continue;

            const name =
              specifier.local.type === 'Identifier' ? specifier.local.name : specifier.local.value;
            const owned = ownedImports.get(name);

            if (owned)
              context.report({
                node,
                message: owned === 'connection' ? connectionMessage : schemaMessage
              });
          }

          return;
        }

        const restricted = kind(node.source.value, true);

        if (restricted === 'connection' && node.specifiers.some((s) => s.exportKind !== 'type'))
          context.report({ node, message: connectionMessage });

        if (
          restricted === 'schema' &&
          node.specifiers.some(
            (s) =>
              s.exportKind !== 'type' &&
              migrators.has(s.local.type === 'Identifier' ? s.local.name : s.local.value)
          )
        )
          context.report({ node, message: connectionMessage });

        if (
          restricted === 'schema' &&
          node.specifiers.some(
            (s) =>
              s.exportKind !== 'type' &&
              factories.has(s.local.type === 'Identifier' ? s.local.name : s.local.value)
          )
        )
          context.report({ node, message: schemaMessage });
      },
      ExportAllDeclaration(node) {
        const restricted = kind(node.source.value, true);

        if (restricted && node.exportKind !== 'type')
          context.report({
            node,
            message: restricted === 'connection' ? connectionMessage : schemaMessage
          });
      },
      ImportExpression(node) {
        if (node.source.type !== 'Literal' || typeof node.source.value !== 'string') return;

        const restricted = kind(node.source.value);

        if (schemaOwner && kind(node.source.value, true) === 'schema') {
          context.report({ node, message: connectionMessage });

          return;
        }

        if (restricted)
          context.report({
            node,
            message: restricted === 'connection' ? connectionMessage : schemaMessage
          });
      }
    };
  }
});
