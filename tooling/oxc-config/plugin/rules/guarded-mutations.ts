import { defineRule } from 'vite-plus/lint/plugins';

import {
  api,
  chain,
  sqlStatements,
  statementKind,
  topLevelWhere,
  trivialPredicate,
  sqlTokens,
  templateText
} from './persistence-syntax.ts';
import { production } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    return {
      CallExpression(node) {
        const query = chain(context, node);

        if (
          !query ||
          !['update', 'delete'].includes(query.methods[0].name) ||
          !['run', 'get', 'all', 'execute'].includes(query.methods.at(-1)!.name)
        )
          return;

        const where = query.methods.find(({ name }) => name === 'where');
        const predicate = where?.args[0];
        const text =
          predicate?.type === 'TaggedTemplateExpression' && api(context, predicate.tag, 'sql')
            ? templateText(predicate.quasi)
            : undefined;
        const tokens = text === undefined ? [] : sqlTokens(text);

        if (
          !predicate ||
          (predicate.type === 'Identifier' && predicate.name === 'undefined') ||
          (predicate.type === 'Literal' && predicate.value === true) ||
          (text !== undefined && trivialPredicate(tokens))
        )
          context.report({
            node,
            message: 'Guard update and delete queries with a nontrivial where predicate.'
          });
      },
      TaggedTemplateExpression(node) {
        if (!api(context, node.tag, 'sql')) return;

        const text = templateText(node.quasi);

        if (text === undefined) return;

        const tokens = sqlTokens(text);

        for (const statement of sqlStatements(tokens)) {
          if (!['UPDATE', 'DELETE'].includes(statementKind(statement) ?? '')) continue;

          const predicate = topLevelWhere(statement);

          if (!predicate || trivialPredicate(predicate))
            context.report({
              node,
              message: 'Guard raw SQL UPDATE or DELETE with a nontrivial top-level WHERE.'
            });
        }
      }
    };
  }
});
