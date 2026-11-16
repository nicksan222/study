/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Keeps client AI actions behind the provider-readiness wrapper.                     │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Production apps/client/src code bypassing readiness and guarded clicks by importing,     │
 * │ reexporting or dynamically loading AiButton. The wrapper, .test files and activity-only  │
 * │ AiIcon/AiActivity imports are exempt; this rule does not validate tier props.            │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   import { AiActionButton } from '#client/lib/ai-action-button.tsx';                     │
 * │   const action = <AiActionButton tier="medium" label={t('Generate')} />;                 │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   import { AiButton } from '@study/ui';                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { propertyName } from '../effect-bindings.ts';
import {
  binding,
  constantDeclarator,
  enterNode,
  memberName,
  namedProperty
} from '../lexical-bindings.ts';
import { imported } from '../lexical-bindings.ts';

/** Keep the presentation-only AI action behind the app's provider readiness guard. */
export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (
      !filename.includes('/apps/client/src/') ||
      filename.endsWith('/lib/ai-action-button.tsx') ||
      /\.test\.[jt]sx?$/.test(filename)
    )
      return {};

    const message =
      'Use AiActionButton from #client/lib/ai-action-button.tsx with an explicit tier; app AI actions must check provider readiness and guard clicks.';

    function unwrapValue(node: any): any {
      switch (node.type) {
        case 'AwaitExpression':
        case 'TSAsExpression':
        case 'TSSatisfiesExpression':
        case 'TSNonNullExpression':
          return node.argument ?? node.expression;
        default:
          return null;
      }
    }

    function dynamicNamespace(node: any): boolean {
      return node.source.type === 'Literal' && node.source.value === '@study/ui';
    }

    function namespaceSpecifier(definition: any): boolean {
      const declaration = definition?.parent;

      return (
        definition?.type === 'ImportNamespaceSpecifier' &&
        declaration?.type === 'ImportDeclaration' &&
        declaration.source.value === '@study/ui'
      );
    }

    function importValue(node: any): string | null {
      if (node.type === 'ImportExpression') return dynamicNamespace(node) ? 'namespace' : null;

      const definition = binding(context, node)?.defs[0]?.node;

      if (namespaceSpecifier(definition)) return 'namespace';

      return imported(context, node, /^@study\/ui$/, 'AiButton') ? 'AiButton' : null;
    }

    function aliasValue(node: any, seen: Set<any>): string | null {
      const definition = binding(context, node)?.defs[0]?.node;

      if (!constantDeclarator(definition)) return null;

      if (definition.id.type === 'Identifier') return uiValue(definition.init, seen);

      if (definition.id.type !== 'ObjectPattern' || uiValue(definition.init, seen) !== 'namespace')
        return null;

      return definition.id.properties.some(
        (part: any) =>
          namedProperty(part) &&
          propertyName(part.key) === 'AiButton' &&
          part.value.type === 'Identifier' &&
          part.value.name === node.name
      )
        ? 'AiButton'
        : null;
    }

    function uiValue(node: any, seen = new Set<any>()): string | null {
      if (!enterNode(node, seen)) return null;

      const unwrapped = unwrapValue(node);

      if (unwrapped) return uiValue(unwrapped, seen);

      if (node.type === 'ImportExpression') return importValue(node);

      if (node.type === 'MemberExpression')
        return memberName(node) === 'AiButton' && uiValue(node.object, seen) === 'namespace'
          ? 'AiButton'
          : null;

      if (node.type !== 'Identifier' && node.type !== 'JSXIdentifier') return null;

      return importValue(node) ?? aliasValue(node, seen);
    }

    function jsxNamespaceObject(node: any): boolean {
      return node.type === 'JSXIdentifier' && uiValue(node) === 'namespace';
    }

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@study/ui' || node.importKind === 'type') return;

        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.importKind !== 'type' &&
            propertyName(specifier.imported) === 'AiButton'
          )
            context.report({ node: specifier, message });
        }
      },
      ExportNamedDeclaration(node) {
        if (
          node.source?.value === '@study/ui' &&
          node.exportKind !== 'type' &&
          node.specifiers.some(
            (specifier) =>
              specifier.exportKind !== 'type' && propertyName(specifier.local) === 'AiButton'
          )
        )
          context.report({ node, message });
      },
      ExportAllDeclaration(node) {
        if (node.source.value === '@study/ui' && node.exportKind !== 'type')
          context.report({ node, message });
      },
      MemberExpression(node) {
        if (uiValue(node) === 'AiButton') context.report({ node, message });
      },
      JSXOpeningElement(node) {
        const name = node.name;

        if (
          name.type === 'JSXIdentifier' &&
          uiValue({ ...name, type: 'Identifier', name: name.name }) === 'AiButton'
        )
          context.report({ node, message });

        if (
          name.type === 'JSXMemberExpression' &&
          name.property.name === 'AiButton' &&
          jsxNamespaceObject(name.object)
        )
          context.report({ node, message });
      }
    };
  }
});
