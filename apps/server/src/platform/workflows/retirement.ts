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

import { StudyError } from '@study/contracts/errors';
import { workflowEventSchema } from '@study/contracts/events';
import { and, eq, inArray, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { scrubRetiredConfiguration } from '#server/platform/workflows/configuration';
import { decodeEvent, scrubRetiredEvents } from '#server/platform/workflows/events';
import { scrubRetiredExecution } from '#server/platform/workflows/store';

const correlations = Schema.Array(Schema.String);

export const WorkflowRetirementStore = defineStore({
  name: 'study/WorkflowRetirementStore',
  entity: { singular: 'workflowRetirement', plural: 'workflowRetirements' },
  make: (resources) => {
    const { db } = resources;

    return {
      queries: {
        workflowRetirement: storeQuery({
          role: 'required',
          input: Schema.Void,
          output: Schema.Boolean,
          run: () =>
            !db.orm
              .get(sql`SELECT 1 FROM workflow_executions e WHERE e.payload != '{}' OR e.result IS NOT NULL OR e.owner_token IS NOT NULL OR e.status NOT IN ('completed','cancelled') OR NOT EXISTS (SELECT 1 FROM workflow_retired_executions r WHERE r.execution_id=e.execution_id)
            UNION ALL SELECT 1 FROM workflow_events e WHERE e.payload != '{}' OR NOT EXISTS (SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id=e.correlation_id AND r.event_type=e.type)
            UNION ALL SELECT 1 FROM workflow_activities UNION ALL SELECT 1 FROM workflow_deferreds UNION ALL SELECT 1 FROM workflow_clocks UNION ALL SELECT 1 FROM workflow_configuration_waits LIMIT 1`)
        })
      },
      mutations: {
        prepareBackup: storeMutation({
          input: Schema.Void,
          output: Schema.Void,
          run: () => {
            // Snapshot-only retirement. Preserve receipts and consumed identities; never replay imports.
            for (const event of db.orm.select().from(s.workflowEvents).all()) {
              if (event.payload !== '{}') {
                const decoded = decodeEvent(event.payload);
                if (
                  decoded.eventId !== event.eventId ||
                  decoded.type !== event.type ||
                  decoded.correlationId !== event.correlationId
                )
                  throw new StudyError('invalid_input', 'Invalid captured event identity');
              } else if (
                !db.orm
                  .select()
                  .from(s.workflow_retired_correlations)
                  .where(
                    and(
                      eq(s.workflow_retired_correlations.correlation_id, event.correlationId),
                      eq(s.workflow_retired_correlations.event_type, event.type)
                    )
                  )
                  .get()
              )
                throw new StudyError('invalid_input', 'Unfenced empty event payload');
              db.orm
                .insert(s.workflow_retired_correlations)
                .values({ correlation_id: event.correlationId, event_type: event.type })
                .onConflictDoNothing()
                .run();
            }
            const payload = Schema.decodeUnknownSync(
              Schema.fromJsonString(
                Schema.toCodecJson(Schema.Struct({ event: workflowEventSchema }))
              )
            );
            for (const run of db.orm.select().from(s.workflow_executions).all()) {
              const event = run.payload === '{}' ? undefined : payload(run.payload).event;
              const retired = db.orm
                .select()
                .from(s.workflow_retired_executions)
                .where(eq(s.workflow_retired_executions.execution_id, run.execution_id))
                .get();
              if (!event && !retired)
                throw new StudyError('invalid_input', 'Unfenced empty execution payload');
              const correlation = event?.correlationId ?? retired!.correlation_id;
              if (event)
                db.orm
                  .insert(s.workflow_retired_correlations)
                  .values({ correlation_id: correlation, event_type: event.type })
                  .onConflictDoNothing()
                  .run();
              db.orm
                .insert(s.workflow_retired_executions)
                .values({ execution_id: run.execution_id, correlation_id: correlation })
                .onConflictDoNothing()
                .run();
              scrubRetiredConfiguration(db, run.execution_id);
              scrubRetiredExecution(db, run.execution_id);
            }
            const ids = db.orm
              .select()
              .from(s.workflow_retired_correlations)
              .all()
              .map((row) => row.correlation_id);
            for (const id of ids) scrubRetiredEvents(db, [id]);
          }
        }),
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
