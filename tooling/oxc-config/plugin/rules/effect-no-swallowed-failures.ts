import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, effectProduction } from '../effect-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!effectProduction(context.filename)) return {};

    const bindings = effectBindings(context);
    const message =
      'Handle or propagate Effect failures explicitly instead of silently discarding them.';

    function fallback(node: any): boolean {
      if (!node) return true;

      if (node.type === 'Identifier' && node.name === 'undefined' && !bindings.definition(node))
        return true;

      if (node.type === 'UnaryExpression' && node.operator === 'void') return true;

      if (bindings.resolve(node) === 'Effect.void') return true;

      return node.type === 'CallExpression' && bindings.resolve(node.callee) === 'Effect.succeed';
    }

    function silent(callback: any): boolean {
      if (!callback || !['ArrowFunctionExpression', 'FunctionExpression'].includes(callback.type))
        return false;

      if (callback.body.type !== 'BlockStatement') return fallback(callback.body);

      let meaningful = false;

      function inspect(node: any): void {
        if (!node || typeof node !== 'object') return;

        if (Array.isArray(node)) {
          for (const child of node) inspect(child);

          return;
        }

        if (
          ['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].includes(
            node.type
          )
        )
          return;

        if (
          node.type === 'ThrowStatement' ||
          (node.type === 'ReturnStatement' && !fallback(node.argument))
        )
          meaningful = true;

        for (const [key, child] of Object.entries(node))
          if (key !== 'parent' && key !== 'loc' && key !== 'range') inspect(child);
      }

      inspect(callback.body);

      return !meaningful;
    }

    return {
      ImportDeclaration: bindings.imports,
      CallExpression(node) {
        const name = bindings.resolve(node.callee);

        if (
          name === 'Effect.ignore' ||
          name === 'Effect.ignoreCause' ||
          ((name === 'Effect.catch' || name === 'Effect.catchCause') &&
            silent(node.arguments.at(-1)))
        )
          context.report({ node, message });
      }
    };
  }
});
