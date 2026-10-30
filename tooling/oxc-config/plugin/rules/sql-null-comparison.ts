import { defineRule } from 'vite-plus/lint/plugins';

import { api, sqlTokens, templateText, nullComparison } from './persistence-syntax.ts';
import { production } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    return {
      CallExpression(node) {
        if (
          (api(context, node.callee, 'eq') || api(context, node.callee, 'ne')) &&
          node.arguments.some((arg: any) => arg.type === 'Literal' && arg.value === null)
        )
          context.report({
            node,
            message: 'Use isNull or isNotNull instead of comparing with null.'
          });
      },
      TaggedTemplateExpression(node) {
        if (!api(context, node.tag, 'sql')) return;

        const text = templateText(node.quasi);

        if (text === undefined) return;

        const tokens = sqlTokens(text);

        if (nullComparison(tokens))
          context.report({
            node,
            message: 'Use IS NULL or IS NOT NULL instead of SQL equality with NULL.'
          });
      }
    };
  }
});
