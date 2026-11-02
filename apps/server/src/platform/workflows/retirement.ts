/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Fences retired workflow correlations before removing durable captured content.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Retains durable ownership and content-free retirement state.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy uses public participants; native Workflow owns execution.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { and, inArray, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation } from '#server/platform/definitions/define-store';
import { scrubRetiredConfiguration } from '#server/platform/workflows/configuration';
import { scrubRetiredEvents } from '#server/platform/workflows/events';
import { scrubRetiredExecution } from '#server/platform/workflows/store';

const correlations = Schema.Array(Schema.String);

export const WorkflowRetirementStore = defineStore({
  name: 'study/WorkflowRetirementStore',
  entity: { singular: 'workflowRetirement', plural: 'workflowRetirements' },
  make: (resources) => {
    const { db } = resources;

    return {
      queries: {},
      mutations: {
        fence: storeMutation({
          input: Schema.Struct({ ids: correlations, eventTypes: Schema.Array(Schema.String) }),
          output: Schema.Array(Schema.String),
          run: ({ ids, eventTypes }) => {
            for (const id of ids) {
              for (const type of eventTypes)
                db.orm
                  .insert(s.workflow_retired_correlations)
                  .values({ correlation_id: id, event_type: type })
                  .onConflictDoNothing()
                  .run();
              const runs = db.orm
                .select()
                .from(s.workflow_executions)
                .where(
                  and(
                    sql`json_extract(${s.workflow_executions.payload}, '$.event.correlationId') = ${id}`,
                    inArray(
                      sql<string>`json_extract(${s.workflow_executions.payload}, '$.event.type')`,
                      [...eventTypes]
                    )
                  )
                )
                .all();

              for (const run of runs)
                db.orm
                  .insert(s.workflow_retired_executions)
                  .values({ execution_id: run.execution_id, correlation_id: id })
                  .onConflictDoNothing()
                  .run();
            }

            return db.orm
              .select()
              .from(s.workflow_retired_executions)
              .where(inArray(s.workflow_retired_executions.correlation_id, [...ids]))
              .all()
              .map((row) => row.execution_id);
          }
        }),
        scrub: storeMutation({
          input: correlations,
          output: Schema.Void,
          run: (ids) => {
            const runs = db.orm
              .select()
              .from(s.workflow_retired_executions)
              .where(inArray(s.workflow_retired_executions.correlation_id, [...ids]))
              .all();

            for (const run of runs) {
              scrubRetiredConfiguration(db, run.execution_id);

              scrubRetiredExecution(db, run.execution_id);
            }

            scrubRetiredEvents(db, ids);
          }
        })
      }
    };
  }
});
