import { defineRule } from 'vite-plus/lint/plugins';

import { serverProduction, propertyName } from '../effect-bindings.ts';
import { binding, constantAliasValue, lexicalResolver } from '../lexical-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const path = context.filename.replaceAll('\\', '/');

    if (!serverProduction(path) || /\/src\/runtime\/(?:config|main)\.ts$/.test(path)) return {};

    const resolve = lexicalResolver(resolveIdentifier, resolveMember);

    function resolveMember(node: any, seen: Set<any>): string | null {
      const base = resolve(node.object, seen);
      const name =
        !node.computed || node.property.type === 'Literal' ? propertyName(node.property) : null;

      return base === 'globalThis' && name === 'process'
        ? 'process'
        : base && name
          ? `${base}.${name}`
          : null;
    }

    function resolveIdentifier(node: any, seen: Set<any>): string | null {
      const def = binding(context, node)?.defs[0]?.node;

      if (!def && node.name === 'process') return 'process';

      if (!def && node.name === 'globalThis') return 'globalThis';

      const imported = processImport(def);

      if (imported) return imported;

      return resolveAlias(node, def, seen);
    }

    function resolveAlias(node: any, def: any, seen: Set<any>): string | null {
      return constantAliasValue(def, seen, resolve, (pattern, base) => {
        if (!base) return null;

        const prop = pattern.properties.find(
          (p: any) => p.type === 'Property' && p.value?.name === node.name
        );
        const name = propertyName(prop?.key);

        return name ? `${base}.${name}` : null;
      });
    }

    function report(node: any) {
      context.report({
        node,
        message: 'Read environment variables only at server startup or in runtime config.'
      });
    }

    return {
      ImportDeclaration(node) {
        if (['node:process', 'process'].includes(node.source.value)) {
          for (const specifier of node.specifiers)
            if (specifier.type === 'ImportSpecifier' && propertyName(specifier.imported) === 'env')
              report(specifier);
        }
      },
      MemberExpression(node) {
        if (resolve(node) === 'process.env') report(node);
      },
      VariableDeclarator(node) {
        if (
          node.id.type === 'ObjectPattern' &&
          resolve(node.init) === 'process' &&
          node.id.properties.some((p: any) => propertyName(p.key) === 'env')
        )
          report(node);
      }
    };
  }
});

function processImport(def: any): string | null {
  if (
    def?.parent?.type === 'ImportDeclaration' &&
    ['node:process', 'process'].includes(def.parent.source.value)
  ) {
    if (def.type === 'ImportDefaultSpecifier' || def.type === 'ImportNamespaceSpecifier')
      return 'process';

    if (def.type === 'ImportSpecifier' && propertyName(def.imported) === 'env')
      return 'process.env';
  }

  return null;
}
