import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings } from '../effect-bindings.ts';
import { resolveValue } from './module-factories.ts';
import { binding } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const path = context.filename.replaceAll('\\', '/');

    if (!/\/packages\/contracts\/src\//.test(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path))
      return {};

    const effects = effectBindings(context);
    const report = (node: any) =>
      context.report({
        node,
        message: 'Derive public contract data from canonical Effect schemas.'
      });

    function handwritten(node: any, seen = new Set<any>()): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);

      if (node.type === 'TSInterfaceDeclaration' || node.type === 'TSTypeLiteral') return true;

      if (node.type === 'TSTypeAliasDeclaration') return handwritten(node.typeAnnotation, seen);

      if (['TSUnionType', 'TSIntersectionType'].includes(node.type))
        return node.types.some((type: any) => handwritten(type, new Set(seen)));

      if (node.type === 'TSArrayType') return handwritten(node.elementType, seen);

      if (node.type === 'TSTypeOperator') return handwritten(node.typeAnnotation, seen);

      if (node.type === 'TSTypeReference') {
        const parameters = node.typeArguments?.params ?? node.typeParameters?.params ?? [];
        const args =
          node.typeName.type === 'Identifier' && ['Extract', 'Exclude'].includes(node.typeName.name)
            ? parameters.slice(0, 1)
            : parameters;

        if (args.some((type: any) => handwritten(type, new Set(seen)))) return true;

        if (node.typeName.type === 'Identifier')
          return handwritten(binding(context, node.typeName)?.defs[0]?.node, seen);
      }

      return false;
    }

    return {
      ImportDeclaration: effects.imports,
      ExportNamedDeclaration(node) {
        const declaration = node.declaration;

        if (
          declaration?.type === 'TSInterfaceDeclaration' ||
          (declaration?.type === 'TSTypeAliasDeclaration' && handwritten(declaration))
        )
          report(declaration);

        if (!node.source && !declaration)
          for (const specifier of node.specifiers)
            if (handwritten(binding(context, specifier.local)?.defs[0]?.node)) report(specifier);
      },
      CallExpression(node) {
        if (effects.resolve(node.callee) !== 'rpc.Rpc.make') return;

        const options = resolveValue(context, node.arguments[1]);

        if (
          options?.type !== 'ObjectExpression' ||
          !['payload', 'success', 'error'].every((name) =>
            options.properties.some(
              (item: any) => item.type === 'Property' && (item.key.name ?? item.key.value) === name
            )
          )
        )
          context.report({
            node,
            message: 'RPC contracts must declare explicit payload, success and error schemas.'
          });
      },
      MemberExpression(node) {
        if (['Schema.Any', 'Schema.Unknown'].includes(effects.resolve(node) ?? '')) report(node);
      },
      TSTypeQuery(node) {
        if (
          node.exprName?.type === 'TSQualifiedName' &&
          ['$inferSelect', '$inferInsert'].includes(node.exprName.right.name)
        )
          report(node);
      },
      TSTypeReference(node) {
        const name = node.typeName;

        if (
          name?.type === 'TSQualifiedName' &&
          ['$inferSelect', '$inferInsert'].includes(name.right?.name)
        )
          report(node);

        if (
          !path.endsWith('/ids.ts') &&
          name?.type === 'TSQualifiedName' &&
          ['Brand', 'Branded'].includes(name.right?.name) &&
          (effects.resolve(name.left) === 'Brand' ||
            (() => {
              const def = binding(context, name.left)?.defs[0]?.node;

              return (
                def?.type === 'ImportSpecifier' &&
                def.imported?.name === 'Brand' &&
                def.parent?.source?.value === 'effect'
              );
            })())
        )
          report(node);
      }
    };
  }
});
