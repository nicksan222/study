import { defineRule } from 'vite-plus/lint/plugins';

import { requireBindings } from '../require-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    // Only connection ownership, the schema facade, and definition metadata touch Drizzle directly.
    if (
      /\/packages\/db\/(?:src\/(?:db|index|schema-builder|table)\.ts|drizzle\.config\.ts)$/.test(
        filename
      ) ||
      /\/packages\/db\/test\//.test(filename)
    )
      return {};

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

    const requireFunction = requireBindings(context);

    function report(node: any): void {
      context.report({
        node,
        message:
          'Import Drizzle through @study/db or the schema-builder facade; schema tables must use defineTable with an explicit search policy.'
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
