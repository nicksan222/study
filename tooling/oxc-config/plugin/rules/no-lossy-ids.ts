import { defineRule } from 'vite-plus/lint/plugins';

import { production, property, binding } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    return {
      CallExpression(node) {
        const callee: any = node.callee;
        const conversion =
          callee.type === 'Identifier' &&
          ['Number', 'parseInt', 'parseFloat'].includes(callee.name) &&
          !binding(context, callee)?.defs.length;
        const memberConversion =
          ['parseInt', 'parseFloat'].includes(property(callee) ?? '') &&
          callee.object?.name === 'Number' &&
          !binding(context, callee.object)?.defs.length;
        const arg = node.arguments[0];
        const name = arg?.type === 'Identifier' ? arg.name : property(arg);

        if ((conversion || memberConversion) && name && /^(?:id|.*(?:Id|_id))$/.test(name))
          context.report({
            node,
            message: 'Keep database IDs lossless; do not convert IDs to Number.'
          });
      }
    };
  }
});
