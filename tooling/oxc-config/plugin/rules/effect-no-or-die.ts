import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, serverProduction } from '../effect-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!serverProduction(context.filename)) return {};

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
