import { defineRule } from 'vite-plus/lint/plugins';

import { canonicalImport } from '../architecture-imports.ts';
import { effectBindings, serverProduction } from '../effect-bindings.ts';
import { resolveValue } from './module-factories.ts';

export default defineRule({
  meta: { type: 'suggestion' },
  create(context) {
    if (!serverProduction(context.filename)) return {};

    const effects = effectBindings(context);

    return {
      ImportDeclaration: effects.imports,
      CallExpression(node) {
        if (!canonicalImport(context, node.callee, 'define-service', 'defineService')) return;

        const make = resolveValue(context, node.arguments[1]);

        if (make?.type === 'CallExpression' && effects.resolve(make.callee) === 'Effect.gen')
          context.report({
            node: make,
            message: 'Pass the generator factory to defineService; the harness owns Effect.gen.'
          });
      }
    };
  }
});
