import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';
import { binding, memberName } from '../lexical-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (
      !/\/apps\/web\/test\/e2e\//.test(filename) ||
      filename.endsWith('/apps/web/test/e2e/harness/index.ts')
    )
      return {};

    const spec = /\.(?:test|spec)\.[jt]sx?$/.test(filename);
    const blocked = new Set(['route', 'routeFromHAR', 'routeWebSocket', 'waitForTimeout']);
    const edges = moduleEdges(context, (node, source, typeOnly) => {
      if (!source || typeOnly) return;

      if (
        /^(?:playwright(?:-core)?(?:\/|$)|@playwright\/|@study\/db(?:\/|$)|@study\/server(?:\/|$)|vite(?:-plus)?$|node:(?:http|net|child_process|timers(?:\/promises)?))/.test(
          source
        )
      )
        context.report({
          node,
          message: 'Browser specs must acquire resources through the shared E2E harness.'
        });
    });

    function canonical(node: any): boolean {
      const definition = binding(context, node)?.defs[0]?.node;

      return (
        definition?.type === 'ImportSpecifier' &&
        definition.imported?.name === 'withWebE2e' &&
        definition.parent?.source?.value === './harness/index.ts'
      );
    }

    function root(node: any): any {
      if (node?.type === 'CallExpression') return root(node.callee);

      if (node?.type === 'MemberExpression') return root(node.object);

      return node;
    }

    function harnessCall(callback: any): any {
      const statements = callback?.body?.body;

      if (statements?.length !== 1 || statements[0].type !== 'ExpressionStatement') return;

      const expression = statements[0].expression;

      return expression.type === 'AwaitExpression' ? expression.argument : undefined;
    }

    function registration(node: any): boolean {
      const owner = root(node.callee);

      return (
        owner?.type === 'Identifier' &&
        /^test(?:Stable|Regression|Migration|Characterization)$/.test(owner.name) &&
        !(node.parent?.type === 'CallExpression' && node.parent.callee === node)
      );
    }

    return {
      ...edges,
      MemberExpression(node: any) {
        if (
          blocked.has(memberName(node) ?? '') ||
          (memberName(node) === 'setTimeout' &&
            ['globalThis', 'window', 'global'].includes(node.object?.name) &&
            !binding(context, node.object)?.defs.length)
        )
          context.report({
            node,
            message: 'Browser specs cannot mock requests or use fixed waits.'
          });
      },
      Identifier(node: any) {
        if (
          node.name === 'setTimeout' &&
          node.parent?.type !== 'ImportSpecifier' &&
          !binding(context, node)?.defs.length &&
          !(
            node.parent?.type === 'MemberExpression' &&
            node.parent.property === node &&
            !node.parent.computed
          )
        )
          context.report({ node, message: 'Browser specs cannot use fixed waits.' });
      },
      VariableDeclarator(node: any) {
        if (
          node.id.type === 'ObjectPattern' &&
          node.id.properties.some((part: any) => blocked.has(part.key?.name ?? part.key?.value))
        )
          context.report({
            node,
            message: 'Browser specs cannot mock requests or use fixed waits.'
          });
      },
      CallExpression(node: any) {
        edges.CallExpression(node);

        if (!spec || !registration(node)) return;

        const callback = node.arguments.find((arg: any) =>
          ['ArrowFunctionExpression', 'FunctionExpression'].includes(arg.type)
        );
        const call = harnessCall(callback);

        if (!call || call.type !== 'CallExpression' || !canonical(call.callee))
          context.report({
            node,
            message: 'Run every browser test through withWebE2e from the shared harness.'
          });
      }
    };
  }
});
