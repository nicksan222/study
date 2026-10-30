import { defineRule } from 'vite-plus/lint/plugins';

import { isPresentationAttribute, webPresentationSource } from '../presentation-attributes.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (!webPresentationSource(filename, /\.(?:test|spec)\.[jt]sx?$/)) return {};

    return {
      ImportDeclaration(node) {
        const source = node.source.value;

        if (!/\.(?:css|scss|sass|less)(?:\?|$)/.test(source)) return;

        if (
          filename.endsWith('/apps/web/src/main.tsx') &&
          (source === './styles.css' || source === '@study/ui/styles.css')
        )
          return;

        context.report({
          node,
          message: 'Keep presentation styles in @study/ui; only main.tsx imports global styles.'
        });
      },
      JSXOpeningElement(node) {
        // Shared component overrides are checked by shared-ui-variants.
        if (node.name.type !== 'JSXIdentifier' || !/^[a-z]/.test(node.name.name)) return;

        for (const attribute of node.attributes) {
          if (isPresentationAttribute(attribute))
            context.report({
              node: attribute,
              message: 'Move styled markup into @study/ui and expose semantic component props.'
            });
        }
      }
    };
  }
});
