import { dirname, resolve } from 'node:path';

import { defineRule } from 'vite-plus/lint/plugins';
import type { ESTree } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';
import { effectBindings } from '../effect-bindings.ts';
import { binding, memberName } from '../lexical-bindings.ts';

const controls = new Set(['button', 'input', 'select', 'textarea', 'option']);

const sharedControls =
  /^@study\/ui\/(?:button|input|textarea|select|switch|checkbox|radio|range|number|icon-button|navigation-button|action-button)(?:-|$)/;

function featureComponent(filename: string, source: string): boolean {
  const target = source.startsWith('.') ? resolve(dirname(filename), source) : source;

  return /\/features\/[^/]+\//.test(target.replaceAll('\\', '/'));
}

/** Fixture entrypoints compose real feature views; production state and transport stay outside. */
export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (!filename.includes('/apps/web/src/feature-previews/') || /\.test\.[jt]sx?$/.test(filename))
      return {};

    let renderedFeature = false;
    const bindings = effectBindings(context);

    function componentImport(name: ESTree.JSXOpeningElement['name']): string | undefined {
      if (name.type === 'JSXMemberExpression') return componentImport(name.object);

      if (name.type !== 'JSXIdentifier') return;

      const definition = bindings.definition(name);

      return definition?.parent?.type === 'ImportDeclaration' &&
        definition.parent.importKind !== 'type'
        ? definition.parent.source.value
        : undefined;
    }

    function checkNetwork(node: ESTree.CallExpression | ESTree.NewExpression) {
      const callee = node.callee;
      const name = callee.type === 'Identifier' ? callee.name : memberName(callee);
      const root = callee.type === 'MemberExpression' ? callee.object : callee;

      if (
        name &&
        ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest'].includes(name) &&
        root.type === 'Identifier' &&
        (root === callee || ['globalThis', 'window'].includes(root.name)) &&
        !binding(context, root)?.defs.length
      )
        context.report({
          node,
          message: 'Feature previews use fixture data, without network access.'
        });
    }

    const edges = moduleEdges(context, (node, source, typeOnly) => {
      if (!source || typeOnly) return;

      if (
        /^@study\/server(?:\/|$)|^@tanstack\/react-query(?:\/|$)/.test(source) ||
        /(?:^|\/)(?:hooks|platform|runtime|study-client)(?:\/|$)/.test(source) ||
        /(?:^|\/)use-[^/]+$|\.queries(?:\.[cm]?[jt]sx?)?$/.test(source)
      )
        context.report({
          node,
          message:
            'Feature previews compose presentation components with fixture data; do not import production hooks or transport.'
        });
    });

    return {
      ...edges,
      CallExpression(node) {
        edges.CallExpression(node);
        checkNetwork(node);
      },
      NewExpression: checkNetwork,
      JSXOpeningElement(node) {
        const name = node.name;
        const source = componentImport(name);

        if (source && featureComponent(filename, source)) renderedFeature = true;

        if (
          (name.type === 'JSXIdentifier' && controls.has(name.name)) ||
          (source && sharedControls.test(source))
        )
          context.report({
            node,
            message:
              'Render the actual feature control in previews instead of a parallel UI implementation.'
          });
      },
      'Program:exit'(node) {
        if (filename.endsWith('/feature-previews/index.tsx') && !renderedFeature)
          context.report({
            node,
            message: 'The public preview entry must render actual feature components.'
          });
      }
    };
  }
});
