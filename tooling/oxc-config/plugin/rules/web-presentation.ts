/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Keeps styled client markup and stylesheets in the shared UI package.               │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ apps/client/src source outside test/spec suffixes attaching className/style to native    │
 * │ JSX, including literal inline spreads, or importing stylesheets outside main.tsx's two   │
 * │ approved global imports. Unstyled HTML and semantic shared-component props are allowed;  │
 * │ shared component overrides are checked separately by shared-ui-variants.                 │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   import { Button } from '@study/ui/button';                                             │
 * │   const view = <Button variant="secondary" />;                                           │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   const view = <div className="layout" />;                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

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
          filename.endsWith('/apps/client/src/main.tsx') &&
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
