/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Require explicit concurrency limits on variable Effect batches to be finite        │
 * │ positive integers.                                                                       │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ In production server and client source, prevents unbounded or opaque explicit            │
 * │ concurrency on Effect.all/forEach. Omitted concurrency and fixed array/object batches    │
 * │ remain allowed.                                                                          │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   import { Effect } from 'effect';                                                       │
 * │   Effect.forEach(items, work, { concurrency: 4 });                                       │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   import { Effect } from 'effect';                                                       │
 * │   Effect.forEach(items, work, { concurrency: 'unbounded' });                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings } from '../effect-bindings.ts';
import { businessFile, positive, property } from './effect-lifecycle-syntax.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!businessFile(context.filename)) return {};

    const bindings = effectBindings(context);

    return {
      ImportDeclaration: bindings.imports,
      CallExpression(node) {
        const api = bindings.resolve(node.callee);

        if (api !== 'Effect.forEach' && api !== 'Effect.all') return;

        const input = node.arguments[0];
        const curried = curriedForEach(node, api);
        const options = node.arguments[api === 'Effect.forEach' && !curried ? 2 : 1];
        const concurrency = property(options, 'concurrency');

        if (!concurrency || (!curried && fixedBatch(input))) return;

        if (!positive(concurrency))
          context.report({
            node: concurrency,
            message: 'Use a finite positive concurrency limit for variable Effect batches.'
          });
      }
    };
  }
});

function fixedBatch(input: any): boolean {
  if (input?.type === 'ArrayExpression')
    return !input.elements.some((item: any) => item?.type === 'SpreadElement');

  if (input?.type === 'ObjectExpression')
    return !input.properties.some((item: any) => item.type === 'SpreadElement');

  return false;
}

function curriedForEach(node: any, api: string | null): boolean {
  const curried =
    api === 'Effect.forEach' &&
    node.arguments.length === 2 &&
    node.arguments[1]?.type === 'ObjectExpression';

  return curried;
}
