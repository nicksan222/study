import { defineRule } from 'vite-plus/lint/plugins';

import { production, property, binding } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    function unchecked(value: any): boolean {
      return (
        value?.type === 'CallExpression' &&
        property(value.callee) === 'parse' &&
        value.callee.object?.name === 'JSON' &&
        !binding(context, value.callee.object)?.defs.length
      );
    }

    function domain(type: any): boolean {
      return type && !['TSUnknownKeyword', 'TSAnyKeyword'].includes(type.type);
    }

    return {
      TSAsExpression(node) {
        if (domain(node.typeAnnotation) && unchecked(node.expression))
          context.report({
            node,
            message:
              'Decode persisted JSON with the canonical schema instead of asserting its domain type.'
          });
      },
      VariableDeclarator(node) {
        const id: any = node.id;

        if (domain(id.typeAnnotation?.typeAnnotation) && unchecked(node.init))
          context.report({
            node,
            message:
              'Decode persisted JSON with the canonical schema before assigning its domain type.'
          });
      }
    };
  }
});
