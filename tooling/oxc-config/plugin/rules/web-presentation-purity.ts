import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';
import { effectBindings, propertyName } from '../effect-bindings.ts';
import { webFile } from '../web-files.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const current = webFile(context.filename);

    if (!current) return {};

    const view = current.endsWith('.view.tsx');
    const logic = /\.logic\.tsx?$/.test(current);

    if (!view && !logic) return {};

    const bindings = effectBindings(context);
    const browserGlobals = new Set([
      'window',
      'document',
      'localStorage',
      'sessionStorage',
      'navigator',
      'location',
      'history',
      'fetch',
      'setTimeout',
      'setInterval',
      'requestAnimationFrame'
    ]);
    const report = (node: any) =>
      context.report({
        node,
        message:
          'Views render props; logic describes operations. Keep React lifecycle, I/O and execution in their adapters.'
      });

    return {
      ...moduleEdges(context, (node, source, typeOnly) => {
        if (typeOnly) return;

        if (source === null) {
          report(node);

          return;
        }

        if (
          logic &&
          (source === 'react' ||
            source === '@tanstack/react-router' ||
            source.startsWith('@study/ui'))
        ) {
          report(node);

          return;
        }

        if (!view) return;

        if (impureViewImport(node, source)) report(node);
      }),
      Identifier(node) {
        if (!view || !browserGlobals.has(node.name) || bindings.definition(node)) return;

        const parent = node.parent;
        const propertyKey = isPropertyKey(parent, node);

        if (!propertyKey) report(node);
      },
      MemberExpression(node) {
        if (
          !view ||
          node.object.type !== 'Identifier' ||
          !['globalThis', 'global'].includes(node.object.name) ||
          bindings.definition(node.object)
        )
          return;

        if (browserGlobals.has(propertyName(node.property) ?? '')) report(node);
      },
      JSXElement(node) {
        if (logic) report(node);
      },
      JSXFragment(node) {
        if (logic) report(node);
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Promise') report(node);
      },
      AwaitExpression: report
    };
  }
});

function impureViewImport(node: any, source: string): boolean {
  const names = importedNames(node);
  const hooks = names.some((name: string) => name.startsWith('use'));
  const presentationHook =
    source.startsWith('@study/ui/') ||
    (/(?:^|\/)i18n$/.test(source) && names.every((name: string) => name === 'useI18n'));

  return (
    executionImport(source) ||
    (source === '@tanstack/react-router' && names.some((name: string) => name !== 'Link')) ||
    (hooks && !presentationHook) ||
    (source === 'react' && names.some((name: string) => name === '*' || name.startsWith('use')))
  );
}

function isPropertyKey(parent: any, node: any): boolean {
  return (
    (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
    (parent?.type === 'Property' && parent.key === node && !parent.computed)
  );
}

function importedNames(node: any): string[] {
  return (
    node.specifiers?.map((item: any) =>
      item.type === 'ImportSpecifier' && item.imported.type === 'Identifier'
        ? item.imported.name
        : '*'
    ) ?? ['*']
  );
}

function executionImport(source: string): boolean {
  return (
    source === 'effect' ||
    source.startsWith('effect/') ||
    /(?:^|\/)(?:use-[^/]+|[^/]+\.logic)(?:\.tsx?)?$/.test(source) ||
    /study-client\//.test(source)
  );
}
