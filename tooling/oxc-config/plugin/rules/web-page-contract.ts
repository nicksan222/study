import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, propertyName } from '../effect-bindings.ts';
import { typeOnly, webFile } from '../web-files.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const current = webFile(context.filename);

    if (!current) return {};

    const route = current.startsWith('routes/');
    const page = /^pages\/[^/]+\/page\.tsx$/.test(current);
    const logic = current.endsWith('.logic.ts');
    const view = current.endsWith('.view.tsx');
    const hook = /(?:^|\/)use-[^/]+\.ts$/.test(current);
    const bindings = effectBindings(context);
    const imports = new Map<any, { source: string; name: string }>();
    const report = (node: any, message: string) => context.report({ node, message });

    function rememberImports(node: any) {
      if (!typeOnly(node)) {
        for (const item of node.specifiers) {
          const name = item.type === 'ImportSpecifier' ? propertyName(item.imported) : null;

          if (name) imports.set(item, { source: node.source.value, name });
        }
      }
    }

    function checkComponents(options: any) {
      for (const option of options.properties) {
        if (
          option.type !== 'Property' ||
          !['component', 'pendingComponent', 'errorComponent', 'notFoundComponent'].includes(
            propertyName(option.key) ?? ''
          )
        )
          continue;

        if (option.value.type !== 'Identifier' || !imports.has(bindings.definition(option.value)))
          report(
            option,
            'Route components must reference imported presentation or page components.'
          );
      }
    }

    return {
      Program(node) {
        const required = page
          ? ['page.view.tsx', 'page.test.tsx']
          : logic
            ? [current.split('/').at(-1)!.replace(/\.ts$/, '.test.ts')]
            : view || hook
              ? [
                  current
                    .split('/')
                    .at(-1)!
                    .replace(/\.tsx?$/, '.test.tsx')
                ]
              : [];
        const missing = required.filter(
          (name) => !existsSync(join(dirname(context.filename), name))
        );

        if (missing.length)
          report(
            node,
            `Missing sibling page/logic/presentation tests or view: ${missing.join(', ')}.`
          );
      },
      ImportDeclaration(node) {
        rememberImports(node);

        if (route && routeHookImport(node)) {
          report(
            node,
            'Route modules reference page components; application hooks belong in pages.'
          );

          return;
        }

        if ((!route && !page) || typeOnly(node)) return;

        if (
          node.source.value === 'react' ||
          (node.source.value === '@tanstack/react-router' && !route && importsRouterLifecycle(node))
        )
          report(
            node,
            'Keep React lifecycle and state in use-page.ts; routes and pages only compose.'
          );
      },
      CallExpression(node) {
        if (!route) return;

        const factory = node.callee.type === 'CallExpression' ? node.callee.callee : node.callee;

        if (factory.type !== 'Identifier') return;

        const imported = imports.get(bindings.definition(factory));

        if (
          imported?.source !== '@tanstack/react-router' ||
          !['createFileRoute', 'createRootRoute', 'createRootRouteWithContext'].includes(
            imported.name
          )
        )
          return;

        const options = node.arguments[0];

        if (options?.type !== 'ObjectExpression') return;

        checkComponents(options);
      },
      ExportNamedDeclaration(node) {
        if (!route || typeOnly(node)) return;

        const declaration = node.declaration;
        const names =
          declaration?.type === 'VariableDeclaration'
            ? declaration.declarations.map((item) =>
                item.id.type === 'Identifier' ? item.id.name : ''
              )
            : declaration?.type === 'FunctionDeclaration'
              ? [declaration.id?.name]
              : node.specifiers.map((item) =>
                  item.exported.type === 'Identifier' ? item.exported.name : ''
                );

        if (names.some((name) => name !== 'Route'))
          report(
            node,
            'Route modules export only Route; move page behavior and presentation to pages.'
          );
      },
      ExportDefaultDeclaration(node) {
        if (route) report(node, 'Route modules export only Route.');
      },
      ExportAllDeclaration(node) {
        if (route && !typeOnly(node)) report(node, 'Route modules export only Route.');
      },
      JSXElement(node) {
        if (route)
          report(node, 'Route modules reference page components; JSX belongs in pages or app.');
      },
      JSXFragment(node) {
        if (route)
          report(node, 'Route modules reference page components; JSX belongs in pages or app.');
      }
    };
  }
});

function importsHook(node: any): boolean {
  return node.specifiers.some(
    (item: any) =>
      item.type === 'ImportSpecifier' && (propertyName(item.imported) ?? '').startsWith('use')
  );
}

function importsRouterLifecycle(node: any): boolean {
  return node.specifiers.some(
    (item: any) =>
      item.type !== 'ImportSpecifier' ||
      (item.imported.type === 'Identifier' && item.imported.name.startsWith('use'))
  );
}

function routeHookImport(node: any): boolean {
  return !typeOnly(node) && node.source.value !== 'react' && importsHook(node);
}
