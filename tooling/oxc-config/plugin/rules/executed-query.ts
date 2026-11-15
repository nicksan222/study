/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Require discarded server Drizzle builders to execute.                              │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Prevents a standalone query builder from silently doing no database work. Checks         │
 * │ recognized database receivers; storing or returning a builder remains allowed.           │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   import type { Db } from '@study/db';                                                   │
 * │   function read(db: Db) { db.orm.select().from(items).all(); }                           │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   import type { Db } from '@study/db';                                                   │
 * │   function read(db: Db) { db.orm.select().from(items); }                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { chain } from './persistence-syntax.ts';
import { production } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    return {
      ExpressionStatement(node) {
        const query = chain(context, node.expression);

        if (
          query &&
          !query.methods.some(({ name }) => ['run', 'get', 'all', 'execute'].includes(name))
        )
          context.report({
            node,
            message: 'Execute the discarded Drizzle query with run, get, all, or execute.'
          });
      }
    };
  }
});
