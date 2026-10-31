import { defineRule } from 'vite-plus/lint/plugins';

import { memberName as property, imported } from '../lexical-bindings.ts';
import { production, typedOwner } from './synchronous-transactions.ts';

function rawSql(context: any, callee: any): boolean {
  if (property(callee) !== 'raw') return false;

  return (
    imported(context, callee.object, /^(?:drizzle-orm|@study\/db)$/, 'sql') ||
    (property(callee.object) === 'sql' &&
      imported(context, callee.object.object, /^(?:drizzle-orm|@study\/db)$/))
  );
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    return {
      CallExpression(node) {
        const callee: any = node.callee;

        if (property(callee) === 'exec' && typedOwner(context, callee.object)) {
          context.report({
            node,
            message:
              'Connection exec belongs in packages/db infrastructure; use parameterized Drizzle queries in the server.'
          });

          return;
        }

        if (!rawSql(context, callee)) return;

        const value = node.arguments[0];

        if (value?.type === 'Literal' && typeof value.value === 'string') return;

        if (value?.type === 'TemplateLiteral' && value.expressions.length === 0) return;

        context.report({
          node,
          message:
            'Bind SQL values with the Drizzle sql template; sql.raw accepts only constant SQL.'
        });
      }
    };
  }
});
