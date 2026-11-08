import { defineRule } from 'vite-plus/lint/plugins';

import { canonicalImport } from '../architecture-imports.ts';
import { featureEffectBindings } from '../effect-bindings.ts';

export default defineRule({
  meta: { type: 'suggestion' },
  create(context) {
    const effects = featureEffectBindings(context);

    if (!effects) return {};

    return {
      ImportDeclaration: effects.imports,
      ConditionalExpression(node) {
        const branches = [node.consequent, node.alternate];
        const transaction = branches.find(
          (branch) =>
            branch.type === 'CallExpression' &&
            canonicalImport(context, branch.callee, 'define-store', 'transaction')
        );
        const failure = branches.find(
          (branch) =>
            branch.type === 'CallExpression' && effects.resolve(branch.callee) === 'Effect.fail'
        );
        const check = node.test.type === 'UnaryExpression' ? node.test.argument : node.test;

        if (
          transaction &&
          failure &&
          check?.type === 'CallExpression' &&
          check.callee.type === 'CallExpression' &&
          effects.resolve(check.callee.callee) === 'Schema.is'
        )
          context.report({
            node,
            message:
              'Use validatedMutation instead of repeating schema validation and transaction branches.'
          });
      }
    };
  }
});
