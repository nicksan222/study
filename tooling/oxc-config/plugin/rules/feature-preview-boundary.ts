/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Makes fixture previews render real feature presentation without production I/O.    │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Non-test apps/client/src/feature-previews modules importing production hooks/transport,  │
 * │ accessing native network globals, or building duplicate native/shared controls. The      │
 * │ public index.tsx must render an imported feature component; landing art is outside this  │
 * │ scope.                                                                                   │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   // apps/client/src/feature-previews/index.tsx                                          │
 * │   import { QuizQuestion } from '../features/practice/quiz-question';                     │
 * │   export const Preview = () => <QuizQuestion {...fixture} />;                            │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   // apps/client/src/feature-previews/example.tsx                                        │
 * │   const data = fetch('/api');                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunPath } from '@effect/platform-bun';
import { Effect, Path } from 'effect';
import { defineRule } from 'vite-plus/lint/plugins';
import type { ESTree } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';
import { effectBindings } from '../effect-bindings.ts';
import { binding, memberName } from '../lexical-bindings.ts';

const { dirname, resolve } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

const controls = new Set(['button', 'input', 'select', 'textarea', 'option']);

const sharedControlNames = new Set([
  'Button',
  'Input',
  'Textarea',
  'SelectControl',
  'SwitchControl',
  'Checkbox',
  'RadioGroup',
  'RangeControl',
  'NumberControl',
  'IconButton',
  'PreviousButton',
  'NextButton',
  'RetryButton',
  'LoadMoreButton'
]);

const legacySharedControl =
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

    if (
      !filename.includes('/apps/client/src/feature-previews/') ||
      /\.test\.[jt]sx?$/.test(filename)
    )
      return {};

    let renderedFeature = false;
    const bindings = effectBindings(context);

    function namespaceComponent(
      name: ESTree.JSXMemberExpression
    ): { readonly source: string; readonly name: string } | undefined {
      if (name.object.type !== 'JSXIdentifier') return;

      const definition = bindings.definition(name.object);
      const declaration = definition?.parent;

      if (
        definition?.type !== 'ImportNamespaceSpecifier' ||
        declaration?.type !== 'ImportDeclaration' ||
        declaration.source.value !== '@study/ui'
      )
        return;

      return { source: declaration.source.value, name: name.property.name };
    }

    function namedComponent(
      name: ESTree.JSXIdentifier
    ): { readonly source: string; readonly name: string } | undefined {
      const definition = bindings.definition(name);
      const declaration = definition?.parent;

      if (declaration?.type !== 'ImportDeclaration' || declaration.importKind === 'type') return;

      return {
        source: declaration.source.value,
        name:
          definition.type === 'ImportSpecifier'
            ? (definition.imported.name ?? definition.imported.value)
            : name.name
      };
    }

    function componentImport(
      name: ESTree.JSXOpeningElement['name']
    ): { readonly source: string; readonly name: string } | undefined {
      if (name.type === 'JSXMemberExpression')
        return namespaceComponent(name) ?? componentImport(name.object);

      if (name.type === 'JSXIdentifier') return namedComponent(name);
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
        /^@study\/server(?:\/|$)|^@study\/contracts\/react(?:\/|$)/.test(source) ||
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
        const component = componentImport(name);
        const source = component?.source;

        if (source && featureComponent(filename, source)) renderedFeature = true;

        if (
          (name.type === 'JSXIdentifier' && controls.has(name.name)) ||
          (component &&
            (legacySharedControl.test(component.source) ||
              (component.source === '@study/ui' && sharedControlNames.has(component.name))))
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
