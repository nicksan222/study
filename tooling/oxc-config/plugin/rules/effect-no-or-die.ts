/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Preserve typed Effect failures instead of converting them to defects.              │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ In production server and client source, prevents Effect.orDie and orDieWith from erasing │
 * │ recoverable errors. The server runtime/main.ts entry point is exempt.                    │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   import { Effect } from 'effect';                                                       │
 * │   Effect.catchTag('Missing', () => Effect.succeed(null));                                │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   import { Effect } from 'effect';                                                       │
 * │   Effect.orDie(work);                                                                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, effectProduction } from '../effect-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!effectProduction(context.filename)) return {};

    const bindings = effectBindings(context);
    const message =
      'Preserve typed failures instead of converting them to defects with Effect.orDie or Effect.orDieWith.';

    if (context.filename.endsWith('/apps/server/src/runtime/main.ts')) return {};

    return {
      ImportDeclaration: bindings.imports,
      CallExpression(node) {
        if (['Effect.orDie', 'Effect.orDieWith'].includes(bindings.resolve(node.callee) ?? ''))
          context.report({ node, message });
      }
    };
  }
});
