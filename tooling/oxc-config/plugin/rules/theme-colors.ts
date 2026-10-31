import { defineRule } from 'vite-plus/lint/plugins';
import type { ESTree } from 'vite-plus/lint/plugins';

import { hasLiteralColor, hasRawColor, hasRawColorClass } from '../theme-color-values.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!checksThemeColors(context.filename)) return {};

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

  const key = colorContainerKey(parent);

  return (
    key.startsWith('--') ||
    /^(?:color$|background|border|fill|stroke|boxshadow|textshadow|outline|textdecoration|caret|accent|stopcolor|floodcolor|lightingcolor|columnrule)/i.test(
      key.replaceAll('-', '')
    )
  );
}

function checksThemeColors(path: string): boolean {
  const filename = path.replaceAll('\\', '/');

  return /\/(?:apps\/web|packages\/ui)\/src\//.test(filename) && !/\.test\.[jt]sx?$/.test(filename);
}

function colorPropertyName(key: ESTree.Node): string {
  if (key.type === 'Identifier') return key.name;

  return key.type === 'Literal' && typeof key.value === 'string' ? key.value : '';
}

function colorContainerKey(parent: ESTree.Node | null | undefined): string {
  if (parent?.type === 'Property') return colorPropertyName(parent.key);

  return parent?.type === 'JSXAttribute' && parent.name.type === 'JSXIdentifier'
    ? parent.name.name
    : '';
}
