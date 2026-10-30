import { defineRule } from 'vite-plus/lint/plugins';

import { memberName as property, binding } from '../lexical-bindings.ts';
import { production } from './synchronous-transactions.ts';

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

        if (branchesOnMessage(parent, value))
          context.report({
            node,
            message: 'Branch on typed error kinds or codes instead of caught error message text.'
          });
      }
    };
  }
});

function branchesOnMessage(parent: any, value: any): boolean {
  const comparison = messageComparison(parent);
  const textTest = textTestCheck(parent);
  const regexTest = parent?.type === 'CallExpression' && property(parent.callee) === 'test';
  const condition = conditionCheck(parent, value);
  const switched = parent?.type === 'SwitchStatement' && parent.discriminant === value;

  return comparison || textTest || regexTest || condition || switched;
}

function textTestCheck(parent: any): boolean {
  const textTest =
    parent?.type === 'MemberExpression' &&
    ['includes', 'startsWith', 'endsWith', 'match', 'search'].includes(property(parent) ?? '') &&
    parent.parent?.type === 'CallExpression';

  return textTest;
}

function conditionCheck(parent: any, value: any): boolean {
  const condition =
    (parent?.type === 'IfStatement' ||
      parent?.type === 'ConditionalExpression' ||
      parent?.type === 'WhileStatement') &&
    parent.test === value;

  return condition;
}

function messageComparison(parent: any): boolean {
  const comparison =
    parent?.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(parent.operator);

  return comparison;
}
