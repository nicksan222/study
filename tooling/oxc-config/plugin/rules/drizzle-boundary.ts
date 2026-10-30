import { defineRule } from 'vite-plus/lint/plugins';

import { requireBindings } from '../require-bindings.ts';

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

    const requireFunction = requireBindings(context);

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
