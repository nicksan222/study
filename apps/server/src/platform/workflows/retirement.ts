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

import { and, eq, inArray, sql } from '@study/db';
import * as s from '@study/db';
import { Schema } from 'effect';

import { defineStore, storeMutation } from '#server/platform/definitions/define-store';
import { scrubRetiredConfiguration } from '#server/platform/workflows/configuration';
import { scrubRetiredEvents } from '#server/platform/workflows/events';
import {
  scrubRetiredExecution,
  scrubRetiredCorrectionExecution
} from '#server/platform/workflows/store';

const correlations = Schema.Array(Schema.String);

export const WorkflowRetirementStore = defineStore({
  name: 'study/WorkflowRetirementStore',
  entity: { singular: 'workflowRetirement', plural: 'workflowRetirements' },
  make: (resources) => {
    const { db } = resources;

    function retiredExecutions(ids: readonly string[]) {
      return db.orm
        .select()
        .from(s.workflow_retired_executions)
        .where(inArray(s.workflow_retired_executions.correlation_id, [...ids]))
        .all();
    }

    return {
      queries: {},
      mutations: {
        fence: storeMutation({
          changes: ['workflows'],
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
        scrubCorrectionInputs: storeMutation({
          changes: ['workflows'],
          input: correlations,
          output: Schema.Void,
          run: (ids) => {
            const runs = retiredExecutions(ids);

            for (const retired of runs) {
              const run = db.orm
                .select()
                .from(s.workflow_executions)
                .where(eq(s.workflow_executions.execution_id, retired.execution_id))
                .get();

              scrubRetiredConfiguration(db, retired.execution_id);

              if (run?.workflow_tag !== 'source-correction/v1' || run.status !== 'completed') {
                scrubRetiredExecution(db, retired.execution_id);
                continue;
              }
              // The successful correction Activity owns the retained AFTER document. The
              // event/execution payload owns BEFORE text. Fence both before releasing input.

              scrubRetiredCorrectionExecution(db, retired.execution_id);
            }
            // Keep SourceIndexed's content-free exact output identity for later retirement.

            scrubRetiredEvents(db, ids, ['SourceCorrectionRequested']);
          }
        }),
        scrub: storeMutation({
          changes: ['workflows'],
          input: correlations,
          output: Schema.Void,
          run: (ids) => {
            const runs = retiredExecutions(ids);

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
