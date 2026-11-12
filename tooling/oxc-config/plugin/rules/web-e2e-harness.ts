import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';
import { binding, memberName } from '../lexical-bindings.ts';
import { walk } from './effect-lifecycle-syntax.ts';

function fields(node: any): any[] {
  return node?.type === 'ObjectExpression' ? node.properties : [];
}

function callback(node: any): any {
  return node.arguments.find((argument: any) =>
    ['ArrowFunctionExpression', 'FunctionExpression'].includes(argument.type)
  );
}

function explicitReadiness(node: any): boolean {
  const ready = fields(node).find((part: any) => part.key?.name === 'ready')?.value;

  if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(ready?.type)) return false;

  let assertion = false;

  walk(ready.body, (node: any) => {
    if (node.type === 'CallExpression' && node.callee?.name === 'expect') assertion = true;
  });

  return assertion;
}

function awaitsScreenshot(node: any, local: string): boolean {
  if (node.type !== 'AwaitExpression') return false;

  const call = node.argument;

  if (call?.type !== 'CallExpression' || call.callee?.name !== local) return false;

  const name = call.arguments[0];

  return (
    name?.type === 'Literal' &&
    typeof name.value === 'string' &&
    explicitReadiness(call.arguments[1])
  );
}

function hasScreenshot(call: any): boolean {
  const body = callback(call);
  const parts = body?.params?.[0]?.properties ?? [];
  const part = parts.find((property: any) => property.key?.name === 'expectScreenshot');
  const local = part?.value?.name;

  if (!local) return false;

  let captured = false;

  walk(body.body, (node) => {
    if (awaitsScreenshot(node, local)) captured = true;
  });

  return captured;
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (
      !/\/apps\/web\/test\/e2e\//.test(filename) ||
      filename.includes('/apps/web/test/e2e/harness/')
    )
      return {};

    const spec = /\.(?:test|spec)\.[jt]sx?$/.test(filename);
    const blocked = new Set(['route', 'routeFromHAR', 'routeWebSocket', 'waitForTimeout', 'sleep']);
    const edges = moduleEdges(context, (node, source, typeOnly) => {
      if (!source || typeOnly) return;

      if (
        source === './harness/index.ts' &&
        node.type === 'ImportDeclaration' &&
        node.specifiers.some(
          (part: any) =>
            !['testE2e', 'expect'].includes(part.imported?.name) ||
            part.local?.name !== part.imported?.name
        )
      )
        context.report({
          node,
          message:
            'Import testE2e directly; internal fixtures and registration aliases are forbidden in journeys.'
        });

      if (/harness\//.test(source) && source !== './harness/index.ts')
        context.report({
          node,
          message: 'Journeys use only the public testE2e and Playwright assertion APIs.'
        });

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
      const declaration = binding(context, node)?.defs[0]?.node;

      if (declaration?.type !== 'ImportSpecifier') return false;

      return (
        declaration.imported?.name === 'testE2e' &&
        declaration.parent?.source?.value === './harness/index.ts'
      );
    }

    function root(node: any): any {
      if (node?.type === 'CallExpression') return root(node.callee);

      if (node?.type === 'MemberExpression') return root(node.object);

      return node;
    }

    function registration(node: any): boolean {
      const owner = root(node.callee);

      return (
        owner?.type === 'Identifier' &&
        /^test(?:Stable|E2e|Regression|Migration|Characterization)$/.test(owner.name) &&
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

        if (!canonical(node.callee)) {
          context.report({
            node,
            message: 'Declare every browser journey directly with testE2e from the shared harness.'
          });

          return;
        }

        if (!hasScreenshot(node))
          context.report({
            node,
            message: 'Every E2E must await a named screenshot with explicit readiness.'
          });

        const title = node.arguments[0];

        if (
          title?.type !== 'Literal' ||
          typeof title.value !== 'string' ||
          title.value.trim().split(/\s+/).length < 2
        )
          context.report({ node, message: 'Give each E2E a clear descriptive title.' });
      }
    };
  }
});
