import { defineRule } from 'vite-plus/lint/plugins';

import { binding, imported, production, property, typedOwner } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (
      !production(context.filename) ||
      context.filename.replaceAll('\\', '/').endsWith('/platform/database/context.ts')
    )
      return {};

    function db(node: any, seen = new Set<any>()): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);

      if (property(node) === 'db' && typedOwner(context, node.object)) return true;

      if (node.type !== 'Identifier') return false;

      const def = binding(context, node)?.defs[0]?.node;
      const type = (
        def?.id?.typeAnnotation ?? binding(context, node)?.defs[0]?.name?.typeAnnotation
      )?.typeAnnotation;

      if (
        type?.type === 'TSTypeReference' &&
        imported(context, type.typeName, /^@study\/db$/, 'Db')
      )
        return true;

      if (def?.type === 'VariableDeclarator' && def.parent?.kind === 'const') {
        if (
          def.init?.type === 'CallExpression' &&
          property(def.init.callee) === 'open' &&
          imported(context, def.init.callee.object, /^@study\/db$/, 'Db')
        )
          return true;

        return db(def.init, seen);
      }

      return false;
    }

    return {
      CallExpression(node) {
        const callee: any = node.callee;

        if (
          property(callee) === 'transaction' &&
          (db(callee.object) || (property(callee.object) === 'orm' && db(callee.object.object)))
        )
          context.report({
            node,
            message: 'Use ServerContext.transaction for application transactions.'
          });
      }
    };
  }
});
