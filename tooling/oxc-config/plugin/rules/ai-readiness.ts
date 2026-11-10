import { defineRule } from 'vite-plus/lint/plugins';

/** Keep the presentation-only AI action behind the app's provider readiness guard. */
export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (
      !filename.includes('/apps/web/src/') ||
      filename.endsWith('/lib/ai-action-button.tsx') ||
      /\.test\.[jt]sx?$/.test(filename)
    )
      return {};

    const message =
      'Use AiActionButton from #web/lib/ai-action-button.tsx with an explicit tier; app AI actions must check provider readiness and guard clicks.';

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@study/ui/ai-button' || node.importKind === 'type') return;

        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportNamespaceSpecifier' ||
            (specifier.type === 'ImportSpecifier' &&
              specifier.importKind !== 'type' &&
              (specifier.imported.type === 'Identifier'
                ? specifier.imported.name
                : specifier.imported.value) === 'AiButton')
          )
            context.report({ node: specifier, message });
        }
      },
      ExportNamedDeclaration(node) {
        if (
          node.source?.value === '@study/ui/ai-button' &&
          node.exportKind !== 'type' &&
          node.specifiers.some(
            (specifier) =>
              specifier.exportKind !== 'type' &&
              (specifier.local.type === 'Identifier'
                ? specifier.local.name
                : specifier.local.value) === 'AiButton'
          )
        )
          context.report({ node, message });
      },
      ExportAllDeclaration(node) {
        if (node.source.value === '@study/ui/ai-button' && node.exportKind !== 'type')
          context.report({ node, message });
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal' && node.source.value === '@study/ui/ai-button')
          context.report({ node, message });
      }
    };
  }
});
