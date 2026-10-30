import { defineRule } from 'vite-plus/lint/plugins';

import { serverPath } from '../architecture-imports.ts';
import { property as field } from './effect-lifecycle-syntax.ts';
import { isFactory, resolveValue } from './module-factories.ts';
import { binding, resourceType } from './synchronous-transactions.ts';

const roles = new Set([
  'store',
  'service',
  'rpc',
  'workflows',
  'agents',
  'tools',
  'decoders',
  'codecs'
]);

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const path = serverPath(context.filename);
    const match = path && /^features\/[^/]+\/(.+)$/.exec(path);

    if (!match) return {};

    const relative = match[1]!;
    const parts = relative.split('/');
    const report = (node: any, message: string) => context.report({ node, message });

    function factory(node: any, names: string[], seen = new Set<any>()): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);
      const def = binding(context, node)?.defs[0]?.node;

      if (def?.type === 'ImportSpecifier')
        return (
          names.includes(def.imported.name ?? def.imported.value) &&
          /(?:^|\/)define-store(?:\.ts)?$/.test(def.parent.source.value)
        );

      if (def?.type === 'VariableDeclarator' && def.parent?.kind === 'const')
        return factory(def.init, names, seen);

      if (
        node.type === 'MemberExpression' &&
        names.includes(node.property.name ?? node.property.value)
      ) {
        const object = resolveValue(context, node.object);
        const namespace = binding(context, object)?.defs[0]?.node;

        return (
          namespace?.type === 'ImportNamespaceSpecifier' &&
          /(?:^|\/)define-store(?:\.ts)?$/.test(namespace.parent.source.value)
        );
      }

      return false;
    }

    function checkFunction(node: any) {
      const name = node.id?.name ?? node.parent?.id?.name;

      for (const param of node.params) {
        const kind = resourceType(context, param.typeAnnotation);

        if (!kind) continue;

        const allowed =
          parts[0] === 'store' &&
          /^make(?:[A-Z].*)?$/.test(name ?? '') &&
          node.params.length === 1 &&
          kind === 'StoreResources';

        if (!allowed)
          report(param, 'Bind store resources once in a make* factory accepting StoreResources.');
      }
    }

    return {
      Program(node: any) {
        if (
          relative !== 'index.ts' &&
          (!roles.has(parts[0]!) ||
            parts.length < 2 ||
            (['store', 'service'].includes(parts[0]!) &&
              parts.length > 2 &&
              parts.at(-1) === 'index.ts') ||
            /\.(?:store|service|rpc|workflow|agent|tool|decoder|codec)\.[cm]?[jt]sx?$/.test(
              relative
            ))
        )
          report(node, 'Place feature modules in their canonical role folder.');
      },
      ExportNamedDeclaration(node: any) {
        if (
          relative === 'index.ts' &&
          (!node.source ||
            !/^\.\/service\/index(?:\.ts)?$/.test(node.source.value) ||
            node.exportKind === 'type' ||
            node.specifiers.some((specifier: any) => specifier.exportKind === 'type'))
        )
          report(node, 'Feature entrypoints export only their public service.');
      },
      ExportAllDeclaration(node: any) {
        if (relative === 'index.ts')
          report(node, 'Feature entrypoints export only their public service.');
      },
      ExportDefaultDeclaration(node: any) {
        if (relative === 'index.ts')
          report(node, 'Feature entrypoints export only their public service.');
      },
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
      CallExpression(node: any) {
        if (isFactory(context, node.callee, 'store')) {
          const descriptor = resolveValue(context, node.arguments[0]);
          const make = resolveValue(context, field(descriptor, 'make'));

          if (
            !make ||
            !['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(
              make.type
            )
          )
            report(node, 'defineStore requires a make factory for bound descriptors.');
          else {
            const body =
              make.body?.type === 'BlockStatement'
                ? make.body.body.find((statement: any) => statement.type === 'ReturnStatement')
                    ?.argument
                : make.body;
            const result = resolveValue(context, body);

            if (
              result?.type === 'ObjectExpression' &&
              result.properties.every((item: any) => item.type !== 'SpreadElement') &&
              (!field(result, 'queries') || !field(result, 'mutations'))
            )
              report(make, 'Store make must return queries and mutations.');
          }
        }

        if (factory(node.callee, ['storeQuery', 'storeMutation'])) {
          const descriptor = resolveValue(context, node.arguments[0]);
          const run = resolveValue(context, field(descriptor, 'run'));

          if (run && run.params?.length > 1)
            report(run, 'Store operation callbacks accept only their input.');
        }
      }
    };
  }
});
