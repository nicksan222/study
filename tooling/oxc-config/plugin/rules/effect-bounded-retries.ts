import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings } from '../effect-bindings.ts';
import { businessFile, positive, property } from './effect-lifecycle-syntax.ts';

const message =
  'Bound retries with a finite times count or a bounded Schedule.recurs; use a bounded helper for opaque schedules.';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!businessFile(context.filename)) return {};

    const bindings = effectBindings(context);

    function bounded(node: any): boolean {
      if (positive(property(node, 'times'), true)) return true;

      const schedule = property(node, 'schedule');

      if (schedule) return bounded(schedule);

      if (node?.type !== 'CallExpression') return false;

      const api = bindings.resolve(node.callee);

      if (api === 'Schedule.recurs') return positive(node.arguments[0], true);

      if (api === 'Schedule.intersect') return node.arguments.some(bounded);

      if (api === 'Schedule.max' || api === 'Schedule.min') {
        const schedules = node.arguments[0];

        if (
          schedules?.type !== 'ArrayExpression' ||
          schedules.elements.some((item: any) => !item || item.type === 'SpreadElement')
        )
          return false;

        return api === 'Schedule.max'
          ? schedules.elements.some(bounded)
          : schedules.elements.length > 0 && schedules.elements.every(bounded);
      }

      if (api === 'Schedule.union')
        return node.arguments.length === 2 && node.arguments.every(bounded);

      if (
        node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'pipe'
      ) {
        let bound = bounded(node.callee.object);

        for (const step of node.arguments) {
          if (step.type !== 'CallExpression') return false;

          const operation = bindings.resolve(step.callee);

          if (operation === 'Schedule.intersect') bound = bound || step.arguments.some(bounded);
          else if (operation === 'Schedule.union') bound = bound && step.arguments.every(bounded);
          else if (
            !['Schedule.map', 'Schedule.modifyDelay', 'Schedule.jittered', 'Schedule.tap'].includes(
              operation ?? ''
            )
          )
            return false;
        }

        return bound;
      }

      return false;
    }

    return {
      ImportDeclaration: bindings.imports,
      CallExpression(node) {
        const api = bindings.resolve(node.callee);

        if (
          api === 'Effect.retryForever' ||
          (api === 'Effect.retry' && !bounded(node.arguments[node.arguments.length === 1 ? 0 : 1]))
        )
          context.report({ node, message });
      }
    };
  }
});
