import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, serverProduction } from '../effect-bindings.ts';
import { nativeGlobal } from './native-global.ts';

const message = 'Read native clocks only in platform/time; consume testable time elsewhere.';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const path = context.filename.replaceAll('\\', '/');

    if (!serverProduction(path) || path.endsWith('/apps/server/src/platform/time/index.ts'))
      return {};

    const bindings = effectBindings(context);

    return {
      CallExpression(node) {
        if (
          [
            'Date',
            'Date.now',
            'performance.now',
            'process.hrtime',
            'process.hrtime.bigint'
          ].includes(nativeGlobal(bindings, node.callee) ?? '')
        )
          context.report({ node, message });
      },
      NewExpression(node) {
        if (!node.arguments.length && nativeGlobal(bindings, node.callee) === 'Date')
          context.report({ node, message });
      }
    };
  }
});
