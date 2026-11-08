import { defineRule } from 'vite-plus/lint/plugins';

import { serverProduction } from '../effect-bindings.ts';
import { imported, memberName } from '../lexical-bindings.ts';
import { property } from './effect-lifecycle-syntax.ts';
import { resolveValue } from './module-factories.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (
      !serverProduction(context.filename) ||
      !/\/features\/[^/]+\/workflows\//.test(context.filename)
    )
      return {};

    return {
      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression' || memberName(node.callee) !== 'cancel') return;

        const owner = resolveValue(context, node.callee.object);
        const mode = property(resolveValue(context, node.arguments[0]), 'mode');

        if (
          owner?.type === 'YieldExpression' &&
          imported(
            context,
            owner.argument,
            /^#server\/platform\/workflows\/control$/,
            'WorkflowControl'
          ) &&
          mode?.type === 'Literal' &&
          mode.value === 'unsafe'
        )
          context.report({
            node,
            message:
              'Use cleanupActivity for unsafe workflow retirement so cancellation precedes guarded cleanup and failure settlement.'
          });
      }
    };
  }
});
