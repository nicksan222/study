import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, serverProduction } from '../effect-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!serverProduction(context.filename)) return {};

    const bindings = effectBindings(context);
    const message =
      'Use Effect.tryPromise to preserve fallible promise failures in the typed error channel.';

    return {
      ImportDeclaration: bindings.imports,
      CallExpression(node) {
        if (bindings.resolve(node.callee) === 'Effect.promise') context.report({ node, message });
      }
    };
  }
});
