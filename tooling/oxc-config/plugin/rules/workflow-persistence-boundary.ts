/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reserve workflow state and Effect execution storage for their owners.              │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Prevents server production writes to workflow tables outside mapped platform owners.     │
 * │ Reads remain allowed. Across non-test files, cluster_* schema and mutation SQL stay      │
 * │ owned by official Effect infrastructure, including literal SQL and table declarations.   │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   // apps/server/src/features/notes/store/read.ts                                        │
 * │   import type { Db } from '@study/db';                                                   │
 * │   import { workflow_executions } from '@study/db';                                       │
 * │   function read(db: Db) { return db.orm.select().from(workflow_executions).all(); }      │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   // apps/server/src/features/notes/store/write.ts                                       │
 * │   import type { Db } from '@study/db';                                                   │
 * │   import { workflow_executions } from '@study/db';                                       │
 * │   function write(db: Db) { db.orm.update(workflow_executions).set({}); }                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { persistenceWriters, sqlMutationTargets } from './persistence-writers.ts';
import { production } from './synchronous-transactions.ts';

const owners: Record<string, string[]> = {
  workflow_retired_correlations: ['retirement'],
  workflow_retired_executions: ['retirement'],
  workflow_executions: ['store', 'triggers'],
  workflow_agent_progress: ['agent-progress', 'store'],
  workflow_events: ['events'],
  workflow_receipts: ['triggers'],
  workflow_configuration_waits: ['retry', 'configuration']
};

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const domain = production(context.filename);

    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(context.filename)) return {};

    const path = context.filename.replaceAll('\\', '/');
    const allowed = (table: string) =>
      (table === 'workflow_executions' &&
        path.endsWith('/apps/server/src/platform/definitions/define-workflow-handler.ts')) ||
      owners[table]?.some((owner) =>
        path.endsWith(`/apps/server/src/platform/workflows/${owner}.ts`)
      );
    const report = (node: any, table: string) => {
      if (domain && owners[table] && !allowed(table))
        context.report({ node, message: `Only the canonical workflow owner may write ${table}.` });
    };

    const writers = persistenceWriters(context, (node, table) => {
      report(node, table);

      if (
        table.startsWith('cluster_') &&
        ['insert', 'update', 'delete'].includes(node.callee?.property?.name)
      )
        context.report({
          node,
          message: 'Official Effect owns execution infrastructure schema and writes.'
        });
    });
    const inspect = (node: any, text: string) => {
      if (sqlMutationTargets(text).some((table) => table.startsWith('cluster_')))
        context.report({
          node,
          message: 'Official Effect owns execution infrastructure schema and writes.'
        });
    };

    return {
      ...writers,
      Literal(node: any) {
        if (typeof node.value === 'string') inspect(node, node.value);
      },
      TemplateLiteral(node: any) {
        inspect(
          node,
          node.quasis.map((part: any) => part.value.cooked ?? part.value.raw).join(' __value__ ')
        );
      },
      CallExpression(node: any) {
        writers.CallExpression(node);
        const callee = node.callee.type === 'CallExpression' ? node.callee.callee : node.callee;
        const name = callee.name ?? callee.property?.name;

        if (
          ['sqliteTable', 'sqliteTableCreator', 'defineTable'].includes(name) &&
          typeof node.arguments[0]?.value === 'string' &&
          node.arguments[0].value.startsWith('cluster_')
        )
          context.report({
            node,
            message: 'Official Effect owns execution infrastructure schema and writes.'
          });
      }
    };
  }
});
