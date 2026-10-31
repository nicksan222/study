import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';
import { effectBindings, propertyName } from '../effect-bindings.ts';
import { webFile, webTarget } from '../web-files.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const current = webFile(context.filename);

    if (!current) return {};

    const queries = current.endsWith('.queries.ts');
    const adapter =
      current === 'lib/effect/runtime.ts' || (current.startsWith('lib/study-client/') && !queries);
    const bindings = effectBindings(context);
    const report = (node: any, message: string) => context.report({ node, message });

    function checkQueryOptions(node: any, source: string) {
      if (
        !queries &&
        source === '@tanstack/react-query' &&
        node.type === 'ImportDeclaration' &&
        node.specifiers.some((item: any) =>
          ['queryOptions', 'infiniteQueryOptions', 'mutationOptions'].includes(
            propertyName(item.imported) ?? ''
          )
        )
      )
        report(node, 'Define shared query and mutation options in .queries.ts modules.');
    }

    const edges = moduleEdges(context, (node, source, typeOnly) => {
      if (typeOnly || source === null) return;

      if (requiresEffectAdapter(adapter, source)) {
        const schemaOnly = schemaImport(node, source);

        if (!schemaOnly)
          report(
            node,
            'Keep Effect execution and composition inside the browser transport adapter; use Promise requests and Query options.'
          );
      }

      const target = webTarget(context.filename, source);

      if (!adapter && target?.startsWith('lib/effect/'))
        report(
          node,
          'Use TanStack Query for async state; only the transport adapter may access the Effect runtime.'
        );

      if (target === 'lib/study-client/operations' && !queries && current !== 'lib/appearance.ts')
        report(
          node,
          'Call browser requests from .queries.ts modules; consume shared Query options in hooks and loaders.'
        );

      checkQueryOptions(node, source);
    });

    return {
      ...edges,
      ImportDeclaration(node) {
        bindings.imports(node);
        edges.ImportDeclaration(node);
      },
      Property(node) {
        if (!queries && ['queryFn', 'mutationFn'].includes(propertyName(node.key) ?? ''))
          report(
            node,
            'Define queryFn and mutationFn in .queries.ts modules so loaders and hooks share one data contract.'
          );
      },
      CallExpression(node) {
        edges.CallExpression(node);

        if (bindings.resolve(node.callee) !== 'Effect.gen') return;

        for (let parent: typeof node.parent | null = node.parent; parent; parent = parent.parent) {
          if (
            parent.type === 'CallExpression' &&
            bindings.resolve(parent.callee) === 'Effect.gen'
          ) {
            report(node, 'Extract a named operation instead of nesting Effect generators.');

            break;
          }
        }
      }
    };
  }
});

function schemaImport(node: any, source: string): boolean {
  return (
    source === 'effect/Schema' ||
    (source === 'effect' &&
      node.type === 'ImportDeclaration' &&
      node.specifiers.length > 0 &&
      node.specifiers.every(
        (item: any) => item.importKind === 'type' || propertyName(item.imported) === 'Schema'
      ))
  );
}

function requiresEffectAdapter(adapter: boolean, source: string): boolean {
  return !adapter && (source === 'effect' || source.startsWith('effect/'));
}
