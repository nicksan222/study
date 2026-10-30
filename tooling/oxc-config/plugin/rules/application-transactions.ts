import { defineRule } from 'vite-plus/lint/plugins';

import {
  binding,
  imported,
  memberName as property,
  constantDeclarator,
  enterNode
} from '../lexical-bindings.ts';
import { production, typedOwner } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (
      !production(context.filename) ||
      context.filename.replaceAll('\\', '/').endsWith('/platform/database/context.ts')
    )
      return {};

    function db(node: any, seen = new Set<any>()): boolean {
      if (!enterNode(node, seen)) return false;

      if (property(node) === 'db' && typedOwner(context, node.object)) return true;

      if (node.type !== 'Identifier') return false;

      const def = binding(context, node)?.defs[0]?.node;

      if (databaseType(node, def)) return true;

      if (constantDeclarator(def)) {
        if (openedDb(def.init)) return true;

        return db(def.init, seen);
      }

      return false;
    }

    function databaseType(node: any, def: any): boolean {
      const type = (
        def?.id?.typeAnnotation ?? binding(context, node)?.defs[0]?.name?.typeAnnotation
      )?.typeAnnotation;

      if (
        type?.type === 'TSTypeReference' &&
        imported(context, type.typeName, /^@study\/db$/, 'Db')
      )
        return true;

      return false;
    }

    function openedDb(init: any): boolean {
      if (
        init?.type === 'CallExpression' &&
        property(init.callee) === 'open' &&
        imported(context, init.callee.object, /^@study\/db$/, 'Db')
      )
        return true;

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
