import { defineRule } from 'vite-plus/lint/plugins';

import { production, binding, imported } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    return {
      NewExpression(node) {
        const callee: any = node.callee;
        const study = imported(
          context,
          callee,
          /(?:shared\/errors(?:\/index)?|@study\/server\/shared\/errors)$/,
          'StudyError'
        );

        if (
          !(
            study ||
            (callee.type === 'Identifier' &&
              callee.name === 'Error' &&
              !binding(context, callee)?.defs.length)
          )
        )
          return;

        let caught: any = node.parent;

        while (caught && caught.type !== 'CatchClause') {
          if (
            ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(
              caught.type
            )
          )
            return;

          caught = caught.parent;
        }

        if (!caught?.param || caught.param.type !== 'Identifier') return;

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

        const directThrow =
          node.parent?.type === 'ThrowStatement' && node.parent.parent === caught.body;

        if (!refers(message) && !directThrow) return;

        const options = node.arguments[study ? 2 : 1];
        const cause =
          options?.type === 'ObjectExpression' &&
          options.properties.some(
            (entry: any) =>
              entry.type === 'Property' &&
              (entry.key.name ?? entry.key.value) === 'cause' &&
              entry.value.type === 'Identifier' &&
              binding(context, entry.value) === caughtBinding
          );

        if (!cause)
          context.report({
            node,
            message: 'Preserve the caught failure with an explicit cause when wrapping its message.'
          });
      }
    };
  }
});
