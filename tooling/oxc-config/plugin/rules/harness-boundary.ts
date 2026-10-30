import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges, serverPath, targetPath } from '../architecture-imports.ts';
import {
  binding,
  imported,
  memberName as property,
  constantDeclarator,
  enterNode
} from '../lexical-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const path = context.filename.replaceAll('\\', '/');
    const current = serverPath(path);
    const serverTest = /\/apps\/server\//.test(path) && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
    const production = current !== null && !serverTest;
    const edges = moduleEdges(context, (node, source) => {
      if (
        production &&
        source &&
        (/^#testing(?:\/|$)/.test(source) || /(?:^|\/)test\/testing(?:\/|$)/.test(source))
      )
        context.report({ node, message: 'Production modules cannot depend on the test harness.' });
    });

    function resourceOwner(node: any, seen = new Set<any>()): boolean {
      if (!enterNode(node, seen)) return false;

      const importedApp = (value: any, namespace = false): boolean => {
        const definition = binding(context, value)?.defs[0]?.node;

        return (
          definition?.parent?.type === 'ImportDeclaration' &&
          targetPath(context.filename, definition.parent.source.value) === 'runtime/service' &&
          (namespace
            ? definition.type === 'ImportNamespaceSpecifier'
            : definition.imported?.name === 'App')
        );
      };

      if (importedApp(node)) return true;

      if (
        imported(context, node, /^@study\/db$/, 'Db') ||
        imported(context, node, /(?:^#server\/runtime\/service$|^\.\/service\.ts$)/, 'App')
      )
        return true;

      if (memberOwner(node, importedApp)) return true;

      const definition = binding(context, node)?.defs[0]?.node;

      return constantDeclarator(definition) && resourceOwner(definition.init, seen);
    }

    function memberOwner(
      node: any,
      importedApp: (value: any, namespace?: boolean) => boolean
    ): boolean {
      if (
        node.type === 'MemberExpression' &&
        ((property(node) === 'Db' && imported(context, node.object, /^@study\/db$/)) ||
          (property(node) === 'App' && importedApp(node.object, true)))
      )
        return true;

      return false;
    }

    return {
      ...edges,
      CallExpression(node: any) {
        edges.CallExpression(node);

        if (!serverTest || property(node.callee) !== 'open') return;

        const owner = node.callee.object;

        if (resourceOwner(owner))
          context.report({
            node,
            message: 'Acquire application and database resources through the server test harness.'
          });
      }
    };
  }
});
