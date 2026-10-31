import { defineRule } from 'vite-plus/lint/plugins';

import { binding, memberName as property } from '../lexical-bindings.ts';
import { production } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    function query(node: any): boolean {
      if (node?.type === 'CallExpression') return query(node.callee);

      if (node?.type !== 'MemberExpression') return false;

      return ['from', 'orm', 'returning'].includes(property(node) ?? '') || query(node.object);
    }

    function missingValue(expression: any): boolean {
      return (
        (expression.type === 'Literal' && expression.value === null) ||
        (expression.type === 'Identifier' &&
          expression.name === 'undefined' &&
          !binding(context, expression)?.defs.length) ||
        (expression.type === 'UnaryExpression' && expression.operator === 'void')
      );
    }

    return {
      TSNonNullExpression(node) {
        const expression = node.expression;

        if (missingValue(expression)) {
          context.report({
            node,
            message:
              'Return the missing value; required store queries map it to a typed not_found failure.'
          });

          return;
        }

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
