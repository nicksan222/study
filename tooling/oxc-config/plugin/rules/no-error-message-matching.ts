import { defineRule } from 'vite-plus/lint/plugins';

import { production, property, binding } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    return {
      MemberExpression(node) {
        if (property(node) !== 'message' || node.object.type !== 'Identifier') return;

        if (
          !binding(context, node.object)?.defs.some(
            (definition: any) => definition.type === 'CatchClause'
          )
        )
          return;

        let value: any = node;

        while (value.parent?.type === 'TSAsExpression' || value.parent?.type === 'ChainExpression')
          value = value.parent;

        const parent = value.parent;
        const comparison =
          parent?.type === 'BinaryExpression' &&
          ['===', '!==', '==', '!='].includes(parent.operator);
        const textTest =
          parent?.type === 'MemberExpression' &&
          ['includes', 'startsWith', 'endsWith', 'match', 'search'].includes(
            property(parent) ?? ''
          ) &&
          parent.parent?.type === 'CallExpression';
        const regexTest = parent?.type === 'CallExpression' && property(parent.callee) === 'test';
        const condition =
          (parent?.type === 'IfStatement' ||
            parent?.type === 'ConditionalExpression' ||
            parent?.type === 'WhileStatement') &&
          parent.test === value;
        const switched = parent?.type === 'SwitchStatement' && parent.discriminant === value;

        if (comparison || textTest || regexTest || condition || switched)
          context.report({
            node,
            message: 'Branch on typed error kinds or codes instead of caught error message text.'
          });
      }
    };
  }
});
