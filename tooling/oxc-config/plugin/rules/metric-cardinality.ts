import { defineRule } from 'vite-plus/lint/plugins';

import { targetPath } from '../architecture-imports.ts';
import { effectBindings, propertyName, serverProduction } from '../effect-bindings.ts';
import { resolveValue } from './module-factories.ts';

const message =
  'Metric attributes must use bounded literal labels or safeMetricLabels from platform/observability.';

const forbidden =
  /(?:^|[_-])(id|identifier|payload|text|token)(?:$|[_-])|(?:Id|ID|Identifier|Payload|Text|Token)s?$/;

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!serverProduction(context.filename)) return {};

    const bindings = effectBindings(context);

    function helper(node: any): boolean {
      node = resolveValue(context, node);

      if (
        node?.type === 'MemberExpression' &&
        propertyName(node.property) === 'safeMetricLabels' &&
        (!node.computed || node.property.type === 'Literal')
      ) {
        const base = resolveValue(context, node.object);
        const def = base?.type === 'Identifier' && bindings.definition(base);

        return (
          def?.type === 'ImportNamespaceSpecifier' &&
          ['platform/observability', 'platform/observability/index'].includes(
            targetPath(context.filename, def.parent.source.value) ?? ''
          )
        );
      }

      if (node?.type !== 'Identifier') return false;

      const def = bindings.definition(node);

      return (
        def?.type === 'ImportSpecifier' &&
        propertyName(def.imported) === 'safeMetricLabels' &&
        ['platform/observability', 'platform/observability/index'].includes(
          targetPath(context.filename, def.parent.source.value) ?? ''
        )
      );
    }

    function scalar(node: any): boolean {
      node = resolveValue(context, node);

      if (
        node?.type === 'MemberExpression' &&
        node.object.type === 'Identifier' &&
        (!node.computed || node.property.type === 'Literal')
      ) {
        const def = bindings.definition(node.object);

        if (def?.type === 'TSEnumDeclaration') return true;
      }

      return (
        (node?.type === 'Literal' && ['string', 'number', 'boolean'].includes(typeof node.value)) ||
        (node?.type === 'ConditionalExpression' &&
          scalar(node.consequent) &&
          scalar(node.alternate))
      );
    }

    function safe(node: any): boolean {
      node = resolveValue(context, node);

      if (node?.type === 'CallExpression' && helper(node.callee)) return true;

      if (node?.type === 'ArrayExpression')
        return node.elements.every(
          (pair: any) =>
            pair?.type === 'ArrayExpression' &&
            pair.elements.length === 2 &&
            pair.elements[0]?.type === 'Literal' &&
            typeof pair.elements[0].value === 'string' &&
            !forbidden.test(pair.elements[0].value) &&
            scalar(pair.elements[1])
        );

      if (node?.type !== 'ObjectExpression') return false;

      return node.properties.every(
        (item: any) =>
          item.type === 'Property' &&
          (!item.computed || item.key.type === 'Literal') &&
          !!propertyName(item.key) &&
          !forbidden.test(propertyName(item.key)!) &&
          scalar(item.value)
      );
    }

    return {
      ImportDeclaration: bindings.imports,
      CallExpression(node) {
        const name = bindings.resolve(node.callee);

        if (['Effect.provideService', 'Context.make', 'Context.add'].includes(name ?? '')) {
          const index = node.arguments.findIndex(
            (argument: any) => bindings.resolve(argument) === 'Metric.CurrentMetricAttributes'
          );

          if (index >= 0 && !safe(node.arguments[index + 1])) context.report({ node, message });
        } else if (name === 'Metric.withAttributes') {
          if (!safe(node.arguments.at(-1))) context.report({ node, message });
        } else if (
          name &&
          /^Metric\.(counter|gauge|frequency|histogram|summary|summaryWithTimestamp|timer)$/.test(
            name
          ) &&
          node.arguments.length > 1
        ) {
          const options = resolveValue(context, node.arguments[1]);

          if (options?.type !== 'ObjectExpression') {
            context.report({ node, message });

            return;
          }

          for (const item of options.properties) {
            if (
              item.type === 'SpreadElement' ||
              (item.computed && item.key.type !== 'Literal') ||
              (propertyName(item.key) === 'attributes' && !safe(item.value))
            ) {
              context.report({ node, message });
              break;
            }
          }
        }
      }
    };
  }
});
