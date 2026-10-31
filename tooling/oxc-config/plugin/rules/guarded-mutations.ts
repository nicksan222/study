import { defineRule } from 'vite-plus/lint/plugins';

import {
  chain,
  sqlStatements,
  statementKind,
  topLevelWhere,
  trivialPredicate
} from './persistence-syntax.ts';
import { templateTokens } from './sql-template.ts';
import { production } from './synchronous-transactions.ts';

function unguarded(context: any, predicate: any): boolean {
  if (!predicate) return true;

  if (predicate.type === 'Identifier' && predicate.name === 'undefined') return true;

  if (predicate.type === 'Literal' && predicate.value === true) return true;

  if (predicate.type !== 'TaggedTemplateExpression') return false;

  const tokens = templateTokens(context, predicate);

  return tokens !== undefined && trivialPredicate(tokens);
}

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

        if (unguarded(context, predicate))
          context.report({
            node,
            message: 'Guard update and delete queries with a nontrivial where predicate.'
          });
      },
      TaggedTemplateExpression(node) {
        const tokens = templateTokens(context, node);

        if (!tokens) return;

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
