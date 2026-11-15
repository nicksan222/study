/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Require background Effect fibers to retain an owning scope.                        │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ In production server and client source outside runtime/main.ts, prevents forkDetach and  │
 * │ forkIn with an inline Scope.makeUnsafe(). Named scope ownership is not proven by this    │
 * │ rule.                                                                                    │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   import { Effect } from 'effect';                                                       │
 * │   Effect.forkScoped(work);                                                               │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   import { Effect } from 'effect';                                                       │
 * │   Effect.forkDetach(work);                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings } from '../effect-bindings.ts';
import { businessFile } from './effect-lifecycle-syntax.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!businessFile(context.filename) || context.filename.endsWith('/runtime/main.ts')) return {};

    const bindings = effectBindings(context);

    return {
      ImportDeclaration: bindings.imports,
      CallExpression(node) {
        const api = bindings.resolve(node.callee);
        const unowned =
          api === 'Effect.forkIn' &&
          node.arguments
            .slice(0, 2)
            .some(
              (argument: any) =>
                argument.type === 'CallExpression' &&
                bindings.resolve(argument.callee) === 'Scope.makeUnsafe'
            );

        if (api === 'Effect.forkDetach' || unowned)
          context.report({
            node,
            message: 'Use Effect.forkScoped so background fibers have an owning scope.'
          });
      }
    };
  }
});
