import { defineRule } from 'vite-plus/lint/plugins';

import { entry, entryReexport, factoryCall } from './module-factories.ts';

/** Feature-owned service identities are explicit and unique. */
export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const info = entry(context.filename);

    if (!info || info.owner !== 'service') return {};

    const expected = `study/${info.domain.replace(/(^|-)([a-z])/g, (_, _separator, letter) => letter.toUpperCase())}`;
    const calls = new Set<any>();
    let reexport = false;

    function collect(value: any) {
      const call = factoryCall(context, value, 'service');

      if (call) calls.add(call);
    }

    return {
      ExportNamedDeclaration(node: any) {
        if (node.exportKind === 'type') return;

        if (node.source) {
          if (
            node.specifiers.some((specifier: any) => specifier.exportKind !== 'type') &&
            info.index &&
            entryReexport(context, node, info.domain) &&
            /(?:^|[/.])service(?:\/index)?(?:\.ts)?$/.test(node.source.value)
          )
            reexport = true;

          return;
        }

        if (node.declaration?.type === 'VariableDeclaration')
          for (const declaration of node.declaration.declarations) collect(declaration.init);

        for (const specifier of node.specifiers)
          if (specifier.exportKind !== 'type') collect(specifier.local);
      },
      ExportDefaultDeclaration(node: any) {
        collect(node.declaration);
      },
      ExportAllDeclaration(node: any) {
        if (
          node.exportKind !== 'type' &&
          info.index &&
          entryReexport(context, node, info.domain) &&
          /(?:^|[/.])service(?:\/index)?(?:\.ts)?$/.test(node.source.value)
        )
          reexport = true;
      },
      'Program:exit'(node: any) {
        if (calls.size !== 1 && !(calls.size === 0 && reexport)) {
          context.report({
            node,
            message: 'Declare one exported feature capability using defineService.'
          });
        }

        for (const call of calls) {
          const key = call.arguments[0];

          if (key?.type !== 'Literal' || key.value !== expected)
            context.report({
              node: call,
              message: `Use the feature-owned service identity ${expected}.`
            });
        }
      }
    };
  }
});
