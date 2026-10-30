import { defineRule } from 'vite-plus/lint/plugins';

import { memberName as property, binding } from '../lexical-bindings.ts';
import { production } from './synchronous-transactions.ts';

function conversion(context: any, callee: any): boolean {
  if (callee.type === 'Identifier')
    return (
      ['Number', 'parseInt', 'parseFloat'].includes(callee.name) &&
      !binding(context, callee)?.defs.length
    );

  return (
    ['parseInt', 'parseFloat'].includes(property(callee) ?? '') &&
    callee.object?.name === 'Number' &&
    !binding(context, callee.object)?.defs.length
  );
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    return {
      CallExpression(node) {
        const callee: any = node.callee;
        const arg = node.arguments[0];
        const name = arg?.type === 'Identifier' ? arg.name : property(arg);

        if (conversion(context, callee) && name && /^(?:id|.*(?:Id|_id))$/.test(name))
          context.report({
            node,
            message: 'Keep database IDs lossless; do not convert IDs to Number.'
          });
      }
    };
  }
});
