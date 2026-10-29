import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings } from '../effect-bindings.ts';
import { businessFile, positive, property } from './effect-lifecycle-syntax.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!businessFile(context.filename)) return {};

    const bindings = effectBindings(context);

    return {
      ImportDeclaration: bindings.imports,
      CallExpression(node) {
        const api = bindings.resolve(node.callee);

        if (api !== 'Effect.forEach' && api !== 'Effect.all') return;

        const input = node.arguments[0];
        const curried =
          api === 'Effect.forEach' &&
          node.arguments.length === 2 &&
          node.arguments[1]?.type === 'ObjectExpression';
        const options = node.arguments[api === 'Effect.forEach' && !curried ? 2 : 1];
        const concurrency = property(options, 'concurrency');

        if (
          !concurrency ||
          (!curried &&
            ((input?.type === 'ArrayExpression' &&
              !input.elements.some((item) => item?.type === 'SpreadElement')) ||
              (input?.type === 'ObjectExpression' &&
                !input.properties.some((item) => item.type === 'SpreadElement'))))
        )
          return;

        if (!positive(concurrency))
          context.report({
            node: concurrency,
            message: 'Use a finite positive concurrency limit for variable Effect batches.'
          });
      }
    };
  }
});
