/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists provider call accounting and aggregates bounded usage reports.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Records idempotent calls and groups counts by provider, model and task.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the server database and synchronous transactions without accessing provider         │
 * │ credentials.                                                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  usageQuerySchema,
  usageRecordSchema,
  usageReportSchema
} from '@study/contracts/settings/usage';
import { sql } from '@study/db';
import { aiUsage } from '@study/db/schema';
import { Schema } from 'effect';

import { requireRow } from '#server/platform/database/rows';
import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';

/** The ledger survives workflow rollback and records no prompts, responses or credentials. */
export const UsageStore = defineStore({
  name: 'study/UsageStore',
  entity: { singular: 'usageReport', plural: 'usageReports' },
  make: ({ db, clock }) => ({
    mutations: {
      record: storeMutation({
        input: usageRecordSchema,
        output: Schema.Void,
        run: (record) => {
          db.orm.insert(aiUsage).values(record).onConflictDoNothing().run();
        }
      })
    },
    queries: {
      usageReport: storeQuery({
        role: 'required',
        input: usageQuerySchema,
        output: usageReportSchema,
        run: ({ days, provider }) => {
          const now = clock.currentTimeMillisUnsafe();
          const start = now - days * 86400000;
          const where = sql`${aiUsage.timestamp} >= ${start} AND ${aiUsage.timestamp} <= ${now} ${provider === undefined ? sql`` : sql`AND ${aiUsage.provider} = ${provider}`}`;
          const totals = {
            input: sql<number>`coalesce(sum(${aiUsage.input}), 0)`.mapWith(Number),
            cacheRead: sql<number>`coalesce(sum(${aiUsage.cacheRead}), 0)`.mapWith(Number),
            cacheWrite: sql<number>`coalesce(sum(${aiUsage.cacheWrite}), 0)`.mapWith(Number),
            output: sql<number>`coalesce(sum(${aiUsage.output}), 0)`.mapWith(Number),
            reasoning: sql<number>`coalesce(sum(${aiUsage.reasoning}), 0)`.mapWith(Number),
            requests: sql<number>`count(*)`.mapWith(Number),
            runs: sql<number>`count(distinct ${aiUsage.runId})`.mapWith(Number),
            incomplete: sql<number>`coalesce(sum(${aiUsage.incomplete}), 0)`.mapWith(Number)
          };
          const grouped = (key: typeof aiUsage.model | typeof aiUsage.agent) =>
            db.orm
              .select({ key, provider: aiUsage.provider, ...totals })
              .from(aiUsage)
              .where(where)
              .groupBy(key, aiUsage.provider)
              .all();
          const day = sql<string>`strftime('%Y-%m-%d', ${aiUsage.timestamp} / 1000, 'unixepoch')`;
          const daily = db.orm
            .select({ key: day, ...totals })
            .from(aiUsage)
            .where(where)
            .groupBy(day)
            .orderBy(day)
            .all();

          return {
            generatedAt: now,
            totals: requireRow(db.orm.select(totals).from(aiUsage).where(where).get()),
            providers: db.orm
              .selectDistinct({ provider: aiUsage.provider })
              .from(aiUsage)
              .where(sql`${aiUsage.timestamp} >= ${start} AND ${aiUsage.timestamp} <= ${now}`)
              .orderBy(aiUsage.provider)
              .all()
              .map((row) => row.provider),
            models: grouped(aiUsage.model),
            agents: grouped(aiUsage.agent),
            days: daily
          };
        }
      })
    }
  })
});
