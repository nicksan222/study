import { defineRule } from 'vite-plus/lint/plugins';

import { production, property } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    function query(node: any): boolean {
      if (node?.type === 'CallExpression') return query(node.callee);

      if (node?.type !== 'MemberExpression') return false;

      return ['from', 'orm', 'returning'].includes(property(node) ?? '') || query(node.object);
    }

    return {
      TSNonNullExpression(node) {
        const expression = node.expression;

        if (expression.type !== 'CallExpression') return;

        const name = property(expression.callee);

        if (
          !(
            ['find', 'findFirst'].includes(name ?? '') ||
            (name === 'get' && query(expression.callee))
          )
        )
          return;

        context.report({
          node,
          message:
            'Check query results explicitly and report a typed missing record or invariant failure.'
        });
      }
    };
  }
});
