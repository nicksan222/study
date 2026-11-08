import { defineRule } from 'vite-plus/lint/plugins';

import { featureEffectBindings } from '../effect-bindings.ts';

export default defineRule({
  meta: { type: 'suggestion' },
  create(context) {
    const effects = featureEffectBindings(context);

    if (!effects) return {};

    function generatorProgram(call: any): boolean {
      if (call.type !== 'CallExpression' || effects!.resolve(call.callee) !== 'Effect.gen')
        return false;

      const generator = call.arguments[0];

      return (
        generator?.type === 'FunctionExpression' &&
        generator.generator &&
        generator.params.length === 0
      );
    }

    return {
      ImportDeclaration: effects.imports,
      ArrowFunctionExpression(node: any) {
        if (
          node.async ||
          node.returnType ||
          node.params.some((parameter: any) => parameter.type === 'AssignmentPattern')
        )
          return;

        if (generatorProgram(node.body))
          context.report({
            node,
            message:
              'Use Effect.fnUntraced for generator-backed functions instead of an arrow wrapping Effect.gen.'
          });
      }
    };
  }
});
