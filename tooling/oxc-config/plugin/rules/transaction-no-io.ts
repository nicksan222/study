import { defineRule } from 'vite-plus/lint/plugins';

import {
  production,
  binding,
  imported,
  transactionBody,
  transactionCallbacks
} from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    let callbacks = new Set<any>();

    return {
      Program(node) {
        callbacks = transactionCallbacks(context, node);
      },
      CallExpression(node) {
        if (!transactionBody(context, node, callbacks)) return;

        const callee = node.callee;
        const directFetch =
          callee.type === 'Identifier' &&
          callee.name === 'fetch' &&
          !binding(context, callee)?.defs.length;
        const io =
          callee.type === 'Identifier' &&
          imported(context, callee, /^(?:node:fs(?:\/promises)?|node:https?|@study\/ai)$/);
        const memberIo =
          callee.type === 'MemberExpression' &&
          imported(context, callee.object, /^(?:node:fs(?:\/promises)?|node:https?|@study\/ai)$/);

        if (directFetch || io || memberIo)
          context.report({
            node,
            message:
              'Perform network, model and file I/O outside synchronous database transactions.'
          });
      }
    };
  }
});
