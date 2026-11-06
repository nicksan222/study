import { defineRule } from 'vite-plus/lint/plugins';
import type { ESTree } from 'vite-plus/lint/plugins';

import { propertyName } from '../effect-bindings.ts';
import { webFile } from '../web-files.ts';

const actions: Record<string, string> = { Retry: 'RetryButton' };

function translation(node: ESTree.Node): string | undefined {
  if (node.type !== 'JSXExpressionContainer' || node.expression.type !== 'CallExpression') return;

  const key = node.expression.arguments[0];

  return key?.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined;
}

/** Narrow syntax checks for recurring UI scaffolding; document content is excluded. */
export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!webFile(context.filename)) return {};

    const buttons = new Set<string>();

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@study/ui/button') return;

        for (const specifier of node.specifiers)
          if (specifier.type === 'ImportSpecifier' && propertyName(specifier.imported) === 'Button')
            buttons.add(specifier.local.name);
      },
      JSXElement(node) {
        const tag = node.openingElement.name;

        if (tag.type !== 'JSXIdentifier' || !buttons.has(tag.name)) return;

        const children = node.children.filter(
          (child) => child.type !== 'JSXText' || child.value.trim()
        );

        if (children.length !== 1) return;

        const key = translation(children[0]);

        if (key && actions[key])
          context.report({
            node: node.openingElement,
            message: `Use ${actions[key]} from @study/ui/action-button for this shared action.`
          });
      }
    };
  }
});
