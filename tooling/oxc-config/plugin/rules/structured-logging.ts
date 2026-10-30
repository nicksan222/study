import { defineRule } from 'vite-plus/lint/plugins';

import { targetPath } from '../architecture-imports.ts';
import { effectBindings } from '../effect-bindings.ts';
import { resolveValue } from './module-factories.ts';
import { binding, production } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    const effects = effectBindings(context);
    const path = context.filename.replaceAll('\\', '/');
    const observation = path.endsWith('/apps/server/src/platform/observability/index.ts');
    const terminal = /\/apps\/server\/src\/(?:runtime\/(?:request|main|workers))\.ts$/.test(path);
    const allowed = new Set(['requestId', 'executionId', 'entityId', 'causationId']);

    function safeHelper(node: any): boolean {
      node = resolveValue(context, node);

      if (
        node?.type === 'MemberExpression' &&
        !node.computed &&
        node.property.name === 'safeMetadata'
      ) {
        const base = resolveValue(context, node.object);
        const def = binding(context, base)?.defs[0]?.node;

        return (
          def?.type === 'ImportNamespaceSpecifier' &&
          targetPath(context.filename, def.parent.source.value) === 'platform/observability/index'
        );
      }

      if (node?.type !== 'Identifier') return false;

      const def = binding(context, node)?.defs[0]?.node;

      return (
        def?.type === 'ImportSpecifier' &&
        (def.imported.name ?? def.imported.value) === 'safeMetadata' &&
        targetPath(context.filename, def.parent.source.value) === 'platform/observability/index'
      );
    }

    function safeAnnotation(node: any): boolean {
      node = resolveValue(context, node);

      if (node?.type === 'CallExpression' && safeHelper(node.callee)) return true;

      if (node?.type !== 'ObjectExpression') return false;

      return node.properties.every(
        (item: any) =>
          item.type === 'Property' &&
          !item.computed &&
          allowed.has(item.key.name ?? item.key.value) &&
          ((item.value.type === 'Literal' &&
            ['string', 'number', 'boolean'].includes(typeof item.value.value)) ||
            (terminal &&
              item.key.name === 'requestId' &&
              item.value.type === 'CallExpression' &&
              item.value.callee.type === 'Identifier' &&
              item.value.callee.name === 'randomUUID' &&
              binding(context, item.value.callee)?.defs[0]?.node?.parent?.source?.value ===
                'node:crypto'))
      );
    }

    function safeArguments(args: any[]): boolean {
      if (args.length === 0 || args.length > 3) return false;

      const keyIndex = args.length === 3 ? 1 : 0;
      const key = args[keyIndex];

      if (key?.type === 'Literal' && typeof key.value === 'string') {
        const value = args[keyIndex + 1];

        return (
          allowed.has(key.value) &&
          value?.type === 'Literal' &&
          ['string', 'number', 'boolean'].includes(typeof value.value)
        );
      }

      return safeAnnotation(args.at(-1));
    }

    return {
      ImportDeclaration: effects.imports,
      CallExpression(node: any) {
        const name = effects.resolve(node.callee);

        if (
          name &&
          /^Effect\.log(?:Trace|Debug|Info|Warning|Error|Fatal)?$/.test(name) &&
          !observation &&
          !terminal
        )
          context.report({
            node,
            message: 'Effect logging belongs in observability or a terminal error owner.'
          });

        if (
          name &&
          /^Effect\.log(?:Trace|Debug|Info|Warning|Error|Fatal)?$/.test(name) &&
          terminal &&
          !node.arguments.every(
            (arg: any) => arg.type === 'Literal' && typeof arg.value === 'string'
          )
        )
          context.report({
            node,
            message: 'Terminal log messages must be static strings; do not log payloads or errors.'
          });

        if (name === 'Effect.annotateLogs' && !observation && !safeArguments(node.arguments))
          context.report({
            node,
            message:
              'Log annotations must use safeMetadata or an allowlisted scalar metadata object.'
          });
      }
    };
  }
});
