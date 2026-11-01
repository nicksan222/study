import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, effectProduction } from '../effect-bindings.ts';
import { binding } from '../lexical-bindings.ts';
import { callbackTarget } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'suggestion' },
  create(context) {
    if (!effectProduction(context.filename)) return {};

    const effects = effectBindings(context);

    function identity(callback: any): boolean {
      if (!synchronous(callback) || callback.params.length !== 1) return false;

      const parameter = callback.params[0];
      const body = callback.body;
      const returned =
        body.type === 'BlockStatement'
          ? body.body.length === 1 && body.body[0].type === 'ReturnStatement'
            ? body.body[0].argument
            : null
          : body;

      return (
        parameter.type === 'Identifier' &&
        returned?.type === 'Identifier' &&
        binding(context, parameter) === binding(context, returned)
      );
    }

    return {
      ImportDeclaration: effects.imports,
      CallExpression(node) {
        if (effects.resolve(node.callee) !== 'Effect.flatMap') return;

        if (identity(callbackTarget(context, node.arguments.at(-1))))
          context.report({
            node,
            message: 'Use Effect.flatten instead of an identity flatMap callback.'
          });
      }
    };
  }
});

function synchronous(callback: any): boolean {
  return !!callback && !callback.async && !callback.generator;
}
