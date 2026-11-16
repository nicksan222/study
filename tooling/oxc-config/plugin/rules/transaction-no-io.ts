/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Keep recognized external I/O outside server transactions.                          │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Prevents direct global fetch and imported file, HTTP or model calls in synchronous       │
 * │ transaction callbacks. Checks the immediate callback body, including named callbacks,    │
 * │ rather than following arbitrary helper calls or nested functions.                        │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   import type { Db } from '@study/db';                                                   │
 * │   async function write(db: Db) { await fetch(url); db.transaction(() => 1); }            │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   import type { Db } from '@study/db';                                                   │
 * │   function write(db: Db) { db.transaction(() => fetch(url)); }                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { binding, imported } from '../lexical-bindings.ts';
import { production, transactionBody, transactionCallbacks } from './synchronous-transactions.ts';

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
