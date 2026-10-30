import { defineRule } from 'vite-plus/lint/plugins';

import { binding, imported } from '../lexical-bindings.ts';
import { production } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    function preservesCause(options: any, caughtBinding: any): boolean {
      const cause =
        options?.type === 'ObjectExpression' &&
        options.properties.some(
          (entry: any) =>
            entry.type === 'Property' &&
            (entry.key.name ?? entry.key.value) === 'cause' &&
            entry.value.type === 'Identifier' &&
            binding(context, entry.value) === caughtBinding
        );

      return cause;
    }

    function wrapperKind(callee: any): boolean | null {
      const study = imported(
        context,
        callee,
        /(?:shared\/errors(?:\/index)?|@study\/server\/shared\/errors|@study\/contracts(?:\/errors)?)$/,
        'StudyError'
      );

      if (study) return true;

      if (
        callee.type === 'Identifier' &&
        callee.name === 'Error' &&
        !binding(context, callee)?.defs.length
      )
        return false;

      return null;
    }

    return {
      NewExpression(node) {
        const study = wrapperKind(node.callee);

        if (study === null) return;

        const caught = nearestCatch(node.parent);

        if (!namedCatch(caught)) return;

        const message = node.arguments[study ? 1 : 0];

        if (!message) return;

        const caughtBinding = binding(context, caught.param);

        function refers(node: any): boolean {
          if (!node || typeof node !== 'object') return false;

          if (node.type === 'Identifier') return binding(context, node) === caughtBinding;

          for (const [key, value] of Object.entries(node)) {
            if (['parent', 'loc', 'range', 'key', 'property'].includes(key)) continue;

            if (Array.isArray(value) ? value.some(refers) : refers(value)) return true;
          }

          return false;
        }

        const directThrow = directCatchThrow(node, caught);

        if (!refers(message) && !directThrow) return;

        const options = node.arguments[study ? 2 : 1];
        const cause = preservesCause(options, caughtBinding);

        if (!cause)
          context.report({
            node,
            message: 'Preserve the caught failure with an explicit cause when wrapping its message.'
          });
      }
    };
  }
});

function nearestCatch(caught: any): any {
  while (caught && caught.type !== 'CatchClause') {
    if (
      ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(caught.type)
    )
      return null;

    caught = caught.parent;
  }

  return caught;
}

function directCatchThrow(node: any, caught: any): boolean {
  return node.parent?.type === 'ThrowStatement' && node.parent.parent === caught.body;
}

function namedCatch(caught: any): boolean {
  return !!caught?.param && caught.param.type === 'Identifier';
}
