import { defineRule } from 'vite-plus/lint/plugins';
import type { ESTree } from 'vite-plus/lint/plugins';

import { hasLiteralColor, hasRawColor, hasRawColorClass } from '../theme-color-values.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (!/\/(?:apps\/web|packages\/ui)\/src\//.test(filename) || /\.test\.[jt]sx?$/.test(filename))
      return {};

    const message = 'Use semantic theme colors instead of raw colors or palette utilities.';

    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;

        if (
          hasRawColorClass(node.value) ||
          hasLiteralColor(node.value) ||
          (isColorValue(node) && hasRawColor(node.value))
        )
          context.report({ node, message });
      },
      TemplateElement(node) {
        if (
          hasRawColorClass(node.value.raw) ||
          hasLiteralColor(node.value.raw) ||
          (isColorValue(node) && hasRawColor(node.value.raw))
        )
          context.report({ node, message });
      }
    };
  }
});

function isColorValue(node: ESTree.Node): boolean {
  let parent = node.parent;

  while (parent?.type === 'TemplateLiteral' || parent?.type === 'JSXExpressionContainer')
    parent = parent.parent;

  const key =
    parent?.type === 'Property'
      ? parent.key.type === 'Identifier'
        ? parent.key.name
        : parent.key.type === 'Literal' && typeof parent.key.value === 'string'
          ? parent.key.value
          : ''
      : parent?.type === 'JSXAttribute' && parent.name.type === 'JSXIdentifier'
        ? parent.name.name
        : '';

  return (
    key.startsWith('--') ||
    /^(?:color$|background|border|fill|stroke|boxshadow|textshadow|outline|textdecoration|caret|accent|stopcolor|floodcolor|lightingcolor|columnrule)/i.test(
      key.replaceAll('-', '')
    )
  );
}
