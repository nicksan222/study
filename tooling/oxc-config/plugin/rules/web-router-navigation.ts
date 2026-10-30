import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';
import { effectBindings } from '../effect-bindings.ts';
import { webFile } from '../web-files.ts';
import { nativeGlobal } from './native-global.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const current = webFile(context.filename);

    if (!current || current === 'routeTree.gen.ts') return {};

    const routerAdapter = current === 'app/router.ts';

    const bindings = effectBindings(context);
    const report = (node: any) =>
      context.report({
        node,
        message:
          'Use TanStack Link, navigation and validated route search instead of browser URL manipulation.'
      });

    const globalPath = (node: any) => nativeGlobal(bindings, node);

    return {
      ...moduleEdges(context, (node, source, typeOnly) => {
        if (typeOnly || !['@tanstack/react-router', '@tanstack/history'].includes(source ?? ''))
          return;

        if (
          node.specifiers?.some(
            (item: any) =>
              item.imported?.name === 'createHashHistory' ||
              item.local?.name === 'createHashHistory'
          )
        )
          context.report({
            node,
            message: 'Use browser history and standard paths instead of hash routing.'
          });
      }),
      Literal(node) {
        if (
          typeof node.value !== 'string' ||
          !node.value.startsWith('/') ||
          node.value.startsWith('//')
        )
          return;

        const path = node.value.split('?')[0];

        if (
          path !== '/' &&
          !/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*|\$[a-zA-Z][a-zA-Z0-9]*|\$)(?:\/(?:[a-z0-9]+(?:-[a-z0-9]+)*|\$[a-zA-Z][a-zA-Z0-9]*|\$))*$/.test(
            path
          )
        )
          context.report({
            node,
            message:
              'Use lowercase kebab-case internal paths without hash routing or trailing slashes.'
          });
      },
      MemberExpression(node) {
        if (routerAdapter) return;

        const path = globalPath(node)?.replace(/^(?:window|globalThis)\./, '');

        if (!path) return;

        if (/^history\.(?:pushState|replaceState|back|forward|go)$/.test(path)) report(node);

        if (
          /^location\.[^.]+$/.test(path) &&
          !(path === 'location.origin' && current === 'lib/study-client/client.ts') &&
          !(
            node.parent?.type === 'NewExpression' &&
            globalPath(node.parent.callee) === 'URLSearchParams'
          )
        )
          report(node);
      },
      AssignmentExpression(node) {
        if (routerAdapter) return;

        const path = globalPath(node.left)?.replace(/^(?:window|globalThis)\./, '');

        if (path === 'location') report(node);
      },
      NewExpression(node) {
        if (routerAdapter) return;

        if (globalPath(node.callee) === 'URLSearchParams') report(node);
      },
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'a') return;

        for (const attribute of node.attributes) {
          if (attribute.type !== 'JSXAttribute' || attribute.name.name !== 'href') continue;

          const value = hrefValue(attribute);

          if (typeof value === 'string' && /^(?:\/(?!\/)|#\/)/.test(value)) report(attribute);
        }
      }
    };
  }
});

function hrefValue(attribute: any): unknown {
  return attribute.value?.type === 'Literal'
    ? attribute.value.value
    : attribute.value?.type === 'JSXExpressionContainer' &&
        attribute.value.expression.type === 'Literal'
      ? attribute.value.expression.value
      : null;
}
