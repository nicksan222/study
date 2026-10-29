import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, serverProduction } from '../effect-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!serverProduction(context.filename)) return {};

    const bindings = effectBindings(context);
    const message =
      'Run Effects and construct ManagedRuntime only at approved server runtime boundaries.';

    if (
      /\/apps\/server\/src\/runtime\/(?:main|server|service|trpc|workers)\.ts$/.test(
        context.filename
      ) ||
      /\/apps\/server\/src\/client(?:\/|\.ts$)/.test(context.filename)
    )
      return {};

    return {
      ImportDeclaration: bindings.imports,
      CallExpression(node) {
        const name = bindings.resolve(node.callee);

        if (
          name &&
          (/^Effect\.run(?:Promise|PromiseExit|Sync|SyncExit|Fork|Callback)$/.test(name) ||
            name === 'ManagedRuntime.make')
        )
          context.report({ node, message });
      }
    };
  }
});
