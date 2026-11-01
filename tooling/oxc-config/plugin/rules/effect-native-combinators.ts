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

    function undefinedValue(node: any): boolean {
      return (
        node?.type === 'Identifier' &&
        node.name === 'undefined' &&
        !binding(context, node)?.defs.length
      );
    }

    function discards(callback: any): boolean {
      if (
        !synchronous(callback) ||
        callback.params.length > 1 ||
        callback.params.some((parameter: any) => parameter.type !== 'Identifier')
      )
        return false;

      const body = callback.body;

      if (body.type !== 'BlockStatement') return undefinedValue(body);

      if (body.body.length === 0) return true;

      const statement = body.body[0];

      return (
        body.body.length === 1 &&
        statement.type === 'ReturnStatement' &&
        (!statement.argument || undefinedValue(statement.argument))
      );
    }

    return {
      ImportDeclaration: effects.imports,
      CallExpression(node) {
        const api = effects.resolve(node.callee);
        const last = node.arguments.at(-1);

        if (api === 'Effect.flatMap' && identity(callbackTarget(context, last)))
          context.report({
            node,
            message: 'Use Effect.flatten instead of an identity flatMap callback.'
          });

        if (
          (api === 'Effect.map' && discards(callbackTarget(context, last))) ||
          (api === 'Effect.as' && undefinedValue(last))
        )
          context.report({ node, message: 'Use Effect.asVoid instead of a no-op output mapping.' });
      }
    };
  }
});

function synchronous(callback: any): boolean {
  return !!callback && !callback.async && !callback.generator;
}
