import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, serverProduction } from '../effect-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (
      !serverProduction(context.filename) ||
      !context.filename.replaceAll('\\', '/').includes('/src/features/')
    )
      return {};

    const effects = effectBindings(context);

    return {
      ImportDeclaration: effects.imports,
      CallExpression(node) {
        if (/^workflow[./]Activity\.make$/.test(effects.resolve(node.callee) ?? ''))
          context.report({
            node,
            message:
              'Declare feature checkpoints with defineActivity; the harness owns codecs and generator adaptation.'
          });
      }
    };
  }
});
