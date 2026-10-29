import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings } from '../effect-bindings.ts';
import { businessFile } from './effect-lifecycle-syntax.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!businessFile(context.filename) || context.filename.endsWith('/runtime/main.ts')) return {};

    const bindings = effectBindings(context);

    return {
      ImportDeclaration: bindings.imports,
      CallExpression(node) {
        if (bindings.resolve(node.callee) === 'Effect.forkDetach')
          context.report({
            node,
            message: 'Use Effect.forkScoped so background fibers have an owning scope.'
          });
      }
    };
  }
});
