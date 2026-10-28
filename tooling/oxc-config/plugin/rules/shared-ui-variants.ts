import { defineRule } from 'vite-plus/lint/plugins';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (!/\/apps\/web\/src\//.test(filename) || /\.test\.[jt]sx?$/.test(filename)) return {};

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
          const explicit =
            attribute.type === 'JSXAttribute' &&
            attribute.name.type === 'JSXIdentifier' &&
            (attribute.name.name === 'className' || attribute.name.name === 'style');
          const spread =
            attribute.type === 'JSXSpreadAttribute' &&
            attribute.argument.type === 'ObjectExpression' &&
            attribute.argument.properties.some(
              (property) =>
                property.type === 'Property' &&
                !property.computed &&
                ((property.key.type === 'Identifier' &&
                  (property.key.name === 'className' || property.key.name === 'style')) ||
                  (property.key.type === 'Literal' &&
                    (property.key.value === 'className' || property.key.value === 'style')))
            );

          if (explicit || spread)
            context.report({
              node: attribute,
              message: 'Define a shared UI component variant instead of styling it in app code.'
            });
        }
      }
    };
  }
});
