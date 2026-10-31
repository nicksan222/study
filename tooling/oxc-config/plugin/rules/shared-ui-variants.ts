import { defineRule } from 'vite-plus/lint/plugins';

import { isPresentationAttribute, webPresentationSource } from '../presentation-attributes.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (!webPresentationSource(filename, /\.test\.[jt]sx?$/)) return {};

    const components = new Set<string>();
    const namespaces = new Set<string>();

    return {
      ImportDeclaration(node) {
        if (!node.source.value.startsWith('@study/ui/') || node.importKind === 'type') return;

        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') namespaces.add(specifier.local.name);
          else if (specifier.type === 'ImportDefaultSpecifier') {
            if (/^[A-Z]/.test(specifier.local.name)) components.add(specifier.local.name);
          } else if (
            specifier.importKind !== 'type' &&
            specifier.imported.type === 'Identifier' &&
            /^[A-Z]/.test(specifier.imported.name)
          )
            components.add(specifier.local.name);
        }
      },
      JSXOpeningElement(node) {
        let name = node.name;

        while (name.type === 'JSXMemberExpression') name = name.object;

        if (
          name.type !== 'JSXIdentifier' ||
          (!components.has(name.name) && !namespaces.has(name.name))
        )
          return;

        for (const attribute of node.attributes) {
          if (isPresentationAttribute(attribute))
            context.report({
              node: attribute,
              message: 'Define a shared UI component variant instead of styling it in app code.'
            });
        }
      }
    };
  }
});
