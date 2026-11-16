/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Bounds disposable runner caches and isolates harness contract-test artifacts.      │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Canonical createVitest calls anywhere omitting a statically provable fsModuleCache:      │
 * │ false. apps/client/test/e2e/harness/*.test.ts fixtures must not allocate literal         │
 * │ test-results/ paths; temporaryArtifacts owns their directories. Direct Bun.Glob          │
 * │ diagnostic reads are exempt. Unknown later spreads/keys cannot prove the cache stays     │
 * │ disabled.                                                                                │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   import { createVitest } from 'vite-plus/test/node';                                    │
 * │   const runner = createVitest('test', { fsModuleCache: false });                         │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   import { createVitest } from 'vite-plus/test/node';                                    │
 * │   const runner = createVitest('test', { config: false });                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { imported, memberName } from '../lexical-bindings.ts';
import { resolveValue } from './module-factories.ts';

function runner(context: any, callee: any): boolean {
  return (
    imported(context, callee, /^vite-plus\/test\/node$/, 'createVitest') ||
    (memberName(callee) === 'createVitest' &&
      imported(context, callee.object, /^vite-plus\/test\/node$/))
  );
}

function disablesCache(context: any, options: any): boolean {
  const value = resolveValue(context, options);

  if (value?.type !== 'ObjectExpression') return false;

  for (const property of [...value.properties].reverse()) {
    if (property.type === 'SpreadElement') return false;

    const key = propertyKey(context, property);

    if (property.computed && key === undefined) return false;

    if (key === 'fsModuleCache') return resolveValue(context, property.value)?.value === false;
  }

  return false;
}

function propertyKey(context: any, property: any): string | undefined {
  if (!property.computed) return property.key?.name ?? property.key?.value;

  const value = resolveValue(context, property.key)?.value;

  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const contract = /\/apps\/client\/test\/e2e\/harness\/.*\.test\.ts$/.test(filename);
    const reportPath = (node: any, value: unknown) => {
      if (!contract || typeof value !== 'string' || !value.startsWith('test-results/')) return;

      // Reading worker diagnostics does not allocate an artifact directory.
      if (node.parent?.type === 'NewExpression' && memberName(node.parent.callee) === 'Glob')
        return;

      context.report({
        node,
        message:
          'Use temporaryArtifacts() for contract fixtures; test-results belongs to the bounded journey artifact owner.'
      });
    };

    return {
      Literal(node) {
        reportPath(node, node.value);
      },
      TemplateLiteral(node) {
        reportPath(node, node.quasis[0]?.value.cooked);
      },
      CallExpression(node) {
        if (runner(context, node.callee) && !disablesCache(context, node.arguments[1]))
          context.report({
            node,
            message:
              'Disposable Vitest runners must explicitly set fsModuleCache: false so temporary modules do not accumulate on disk.'
          });
      }
    };
  }
});
