import { defineRule } from 'vite-plus/lint/plugins';

import { binding, imported, property } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (/\/packages\/db\//.test(context.filename.replaceAll('\\', '/'))) return {};

    function source(node: any): string | undefined {
      if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;

      if (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
        return node.quasis[0]?.value.cooked;

      return undefined;
    }

    function restricted(node: any): boolean {
      const name = source(node);

      return name !== undefined && /^(?:drizzle-orm|drizzle-kit)(?:\/|$)/.test(name);
    }

    function createRequire(node: any, seen = new Set<any>()): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);

      if (imported(context, node, /^(?:node:)?module$/, 'createRequire')) return true;

      if (
        property(node) === 'createRequire' &&
        imported(context, node.object, /^(?:node:)?module$/)
      )
        return true;

      const definition = binding(context, node)?.defs[0]?.node;

      return (
        definition?.type === 'VariableDeclarator' &&
        definition.parent?.kind === 'const' &&
        createRequire(definition.init, seen)
      );
    }

    function requireFunction(node: any, seen = new Set<any>()): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);

      if (
        node.type === 'Identifier' &&
        node.name === 'require' &&
        !binding(context, node)?.defs.length
      )
        return true;

      if (
        property(node) === 'require' &&
        node.object.type === 'Identifier' &&
        ['module', 'globalThis', 'global'].includes(node.object.name) &&
        !binding(context, node.object)?.defs.length
      )
        return true;

      if (node.type === 'CallExpression' && createRequire(node.callee)) return true;

      const definition = binding(context, node)?.defs[0]?.node;

      return (
        definition?.type === 'VariableDeclarator' &&
        definition.parent?.kind === 'const' &&
        requireFunction(definition.init, seen)
      );
    }

    function report(node: any): void {
      context.report({
        node,
        message:
          'Import Drizzle through @study/db; only packages/db may depend directly on drizzle-orm or drizzle-kit.'
      });
    }

    return {
      ImportDeclaration(node) {
        if (restricted(node.source)) report(node);
      },
      ExportNamedDeclaration(node) {
        if (restricted(node.source)) report(node);
      },
      ExportAllDeclaration(node) {
        if (restricted(node.source)) report(node);
      },
      TSExternalModuleReference(node) {
        if (restricted(node.expression)) report(node);
      },
      TSImportType(node) {
        if (restricted(node.source)) report(node);
      },
      ImportExpression(node) {
        if (restricted(node.source)) report(node);
      },
      CallExpression(node) {
        if (restricted(node.arguments[0]) && requireFunction(node.callee)) report(node);
      }
    };
  }
});
