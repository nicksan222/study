/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Implements synchronous SQLite persistence for workflow executions, activity        │
 * │ checkpoints, deferreds, and clocks. Lease tokens fence stale fibers, and bounded queries │
 * │ support durable recovery.                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports workflowStore. Lease tokens fence stale fibers, and bounded queries support    │
 * │   durable recovery.                                                                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses Drizzle workflow tables through ServerContext; SQLite owns durable checkpoints      │
 * │ while fibers hold temporary leases.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { Db } from '@study/db';
import { and, eq, getTableColumns, gt, inArray, isNull, lte, or, sql } from '@study/db';
import {
  workflow_activities,
  workflow_agent_progress,
  workflow_clocks,
  workflow_deferreds,
  workflow_executions,
  workflow_retired_correlations,
  workflow_retired_executions
} from '@study/db/schema';

import type { ServerContext } from '#server/platform/database/context';
import { requireRow } from '#server/platform/database/rows';
import { isTerminalExecution } from '#server/platform/workflows/status';

const leaseMs = 30_000;

const recoveryBatchSize = 1000;

/** Synchronous durable checkpoints. The owner token fences stale execution fibers. */
export function workflowStore(context: ServerContext) {
  const db = context.db.orm;
  const executionRetired = (id: string) =>
    !!db
      .select()
      .from(workflow_retired_executions)
      .where(eq(workflow_retired_executions.execution_id, id))
      .get();
  const now = () => BigInt(context.clock.currentTimeMillisUnsafe());

  return {
    retired: (id: string) => executionRetired(id),
    execution: (id: string) =>
      db.select().from(workflow_executions).where(eq(workflow_executions.execution_id, id)).get(),
    start(id: string, tag: string, payload: string, parent: string | undefined) {
      return context.transaction(() => {
        const row = db
          .select()
          .from(workflow_executions)
          .where(eq(workflow_executions.execution_id, id))
          .get();

        if (row) {
          if (executionRetired(id)) return row;

          if (row.workflow_tag !== tag || row.payload !== payload)
            throw new Error('Workflow execution identity collision');

          return row;
        }

        if (
          db
            .select()
            .from(workflow_retired_correlations)
            .where(
              sql`${workflow_retired_correlations.correlation_id} = json_extract(${payload}, '$.event.correlationId') AND ${workflow_retired_correlations.event_type} = json_extract(${payload}, '$.event.type')`
            )
            .get()
        )
          throw new StudyError('cancelled', 'Workflow correlation has been retired');

        db.insert(workflow_executions)
          .values({
            execution_id: id,
            workflow_tag: tag,
            version: 1,
            payload,
            parent_execution_id: parent,
            status: 'running',
            owner_token: null,
            created_at: now(),
            updated_at: now()
          })
          .run();

        return undefined;
      });
    },
    interrupt(id: string, mode: 'safe' | 'unsafe') {
      context.transaction(() => {
        const row = db
          .select()
          .from(workflow_executions)
          .where(eq(workflow_executions.execution_id, id))
          .get();

        if (!row || isTerminalExecution(row.status)) return;

        const requested = row.result === '"__interrupt_unsafe__"' ? 'unsafe' : mode;

        db.update(workflow_executions)
          .set({ status: 'running', result: JSON.stringify(`__interrupt_${requested}__`) })
          .where(eq(workflow_executions.execution_id, id))
          .run();
      });
    },
    interruptMode(id: string): 'safe' | 'unsafe' | undefined {
      const row = db
        .select({ result: workflow_executions.result })
        .from(workflow_executions)
        .where(eq(workflow_executions.execution_id, id))
        .get();

      if (row?.result === '"__interrupt_safe__"') return 'safe';

      if (row?.result === '"__interrupt_unsafe__"') return 'unsafe';

      return undefined;
    },
    claim(id: string, owner: string) {
      return context.transaction(() => {
        if (executionRetired(id)) return false;

        const time = now();

        const claimed =
          Number(
            db
              .update(workflow_executions)
              .set({ owner_token: owner, status: 'running', updated_at: time })
              .where(
                and(
                  eq(workflow_executions.execution_id, id),
                  or(
                    eq(workflow_executions.status, 'running'),
                    eq(workflow_executions.status, 'suspended')
                  ),
                  or(
                    isNull(workflow_executions.owner_token),
                    eq(workflow_executions.owner_token, owner),
                    lte(workflow_executions.updated_at, time - BigInt(leaseMs))
                  )
                )
              )
              .run().changes
          ) === 1;

        // Replayed activities must not revive previews from a superseded lease.
        if (claimed)
          db.delete(workflow_agent_progress)
            .where(
              and(
                eq(workflow_agent_progress.execution_id, id),
                sql`${workflow_agent_progress.owner_token} <> ${owner}`
              )
            )
            .run();

        return claimed;
      });
    },
    renew(id: string, owner: string) {
      const time = now();

      return (
        Number(
          db
            .update(workflow_executions)
            .set({ updated_at: time })
            .where(
              and(
                eq(workflow_executions.execution_id, id),
                eq(workflow_executions.owner_token, owner),
                gt(workflow_executions.updated_at, time - BigInt(leaseMs))
              )
            )
            .run().changes
        ) === 1
      );
    },
    release(id: string, owner: string) {
      db.update(workflow_executions)
        .set({ owner_token: null, updated_at: now() })
        .where(
          and(eq(workflow_executions.execution_id, id), eq(workflow_executions.owner_token, owner))
        )
        .run();
    },
    checkpoint(
      id: string,
      owner: string,
      result: string,
      status: 'completed' | 'suspended' | 'cancelled'
    ) {
      if (executionRetired(id)) return;

      const changed = db
        .update(workflow_executions)
        .set({ result, status, owner_token: null, updated_at: now() })
        .where(
          and(
            eq(workflow_executions.execution_id, id),
            eq(workflow_executions.owner_token, owner),
            gt(workflow_executions.updated_at, now() - BigInt(leaseMs)),
            ...(status !== 'cancelled'
              ? [sql`${workflow_executions.result} IS NOT ${'"__interrupt_unsafe__"'}`]
              : []),
            ...(status === 'suspended'
              ? [sql`${workflow_executions.result} IS NOT ${'"__interrupt_safe__"'}`]
              : [])
          )
        )
        .run();

      if (Number(changed.changes) !== 1) throw new Error('Workflow owner was fenced');
    },
    activity(id: string, name: string, attempt: number) {
      return db
        .select()
        .from(workflow_activities)
        .where(
          and(
            eq(workflow_activities.execution_id, id),
            eq(workflow_activities.name, name),
            eq(workflow_activities.attempt, attempt)
          )
        )
        .get()?.result;
    },
    saveActivity(id: string, owner: string, name: string, attempt: number, result: string) {
      context.transaction(() => {
        this.assertOwner(id, owner);

        db.insert(workflow_activities)
          .values({ execution_id: id, name, attempt, result })
          .onConflictDoNothing()
          .run();
      });
    },
    deferred(id: string, name: string) {
      return db
        .select()
        .from(workflow_deferreds)
        .where(and(eq(workflow_deferreds.execution_id, id), eq(workflow_deferreds.name, name)))
        .get()?.result;
    },
    assertOwner(id: string, owner: string) {
      if (executionRetired(id)) throw new Error('Workflow owner was retired');

      const row = db
        .select({ id: workflow_executions.execution_id })
        .from(workflow_executions)
        .where(
          and(
            eq(workflow_executions.execution_id, id),
            eq(workflow_executions.owner_token, owner),
            gt(workflow_executions.updated_at, now() - BigInt(leaseMs))
          )
        )
        .get();

      if (!row) throw new Error('Workflow owner was fenced');
    },
    saveDeferred(id: string, name: string, result: string, source?: { id: string; owner: string }) {
      return context.transaction(() => {
        if (executionRetired(id)) return false;

        if (source) this.assertOwner(source.id, source.owner);

        return (
          Number(
            db
              .insert(workflow_deferreds)
              .values({ execution_id: id, name, result })
              .onConflictDoNothing()
              .run().changes
          ) === 1
        );
      });
    },
    recoverable(tags: readonly string[]) {
      return db
        .select()
        .from(workflow_executions)
        .where(
          and(
            eq(workflow_executions.status, 'running'),
            sql`NOT EXISTS (SELECT 1 FROM workflow_retired_executions r WHERE r.execution_id = ${workflow_executions.execution_id})`,
            inArray(workflow_executions.workflow_tag, [...tags]),
            or(
              isNull(workflow_executions.owner_token),
              lte(workflow_executions.updated_at, now() - BigInt(leaseMs))
            )
          )
        )
        .orderBy(workflow_executions.updated_at, workflow_executions.execution_id)
        .limit(recoveryBatchSize)
        .all();
    },
    dueClocks(tags: readonly string[]) {
      return db
        .select({
          ...getTableColumns(workflow_clocks),
          workflow_tag: workflow_executions.workflow_tag
        })
        .from(workflow_clocks)
        .innerJoin(
          workflow_executions,
          eq(workflow_clocks.execution_id, workflow_executions.execution_id)
        )
        .where(
          and(
            lte(workflow_clocks.due_at, now()),
            inArray(workflow_executions.workflow_tag, [...tags]),
            inArray(workflow_executions.status, ['running', 'suspended'])
          )
        )
        .orderBy(workflow_clocks.due_at, workflow_clocks.execution_id, workflow_clocks.name)
        .limit(recoveryBatchSize)
        .all();
    },
    removeClock(id: string, name: string) {
      db.delete(workflow_clocks)
        .where(and(eq(workflow_clocks.execution_id, id), eq(workflow_clocks.name, name)))
        .run();
    },
    clock(id: string, name: string, deferredName: string, due: bigint, owner: string) {
      return context.transaction(() => {
        this.assertOwner(id, owner);
        db.insert(workflow_clocks)
          .values({ execution_id: id, name, deferred_name: deferredName, due_at: due })
          .onConflictDoNothing()
          .run();

        return requireRow(
          db
            .select()
            .from(workflow_clocks)
            .where(and(eq(workflow_clocks.execution_id, id), eq(workflow_clocks.name, name)))
            .get()
        );
      });
    }
  };
}

/** Remove captured native state only for an execution with a durable retirement fence. */
export function scrubRetiredExecution(db: Db, executionId: string) {
  if (
    !db.orm
      .select()
      .from(workflow_retired_executions)
      .where(eq(workflow_retired_executions.execution_id, executionId))
      .get()
  )
    return;

  for (const table of [
    workflow_activities,
    workflow_deferreds,
    workflow_clocks,
    workflow_agent_progress
  ])
    db.orm.delete(table).where(eq(table.execution_id, executionId)).run();

  db.orm
    .update(workflow_executions)
    .set({
      payload: '{}',
      result: null,
      owner_token: null,
      status: sql`CASE WHEN status = 'completed' THEN 'completed' ELSE 'cancelled' END`
    })
    .where(eq(workflow_executions.execution_id, executionId))
    .run();
}

/** Preserve successful correction output activities while scrubbing retired private inputs. */
export function scrubRetiredCorrectionExecution(db: Db, executionId: string) {
  if (
    !db.orm
      .select()
      .from(workflow_retired_executions)
      .where(eq(workflow_retired_executions.execution_id, executionId))
      .get()
  )
    return;

  db.orm
    .delete(workflow_agent_progress)
    .where(eq(workflow_agent_progress.execution_id, executionId))
    .run();

  db.orm
    .update(workflow_executions)
    .set({ payload: '{}', result: null, owner_token: null })
    .where(eq(workflow_executions.execution_id, executionId))
    .run();
  db.orm
    .delete(workflow_activities)
    .where(
      and(
        eq(workflow_activities.execution_id, executionId),
        sql`${workflow_activities.name} NOT IN ('correct-source','publish-source')`
      )
    )
    .run();
  db.orm.delete(workflow_deferreds).where(eq(workflow_deferreds.execution_id, executionId)).run();
  db.orm.delete(workflow_clocks).where(eq(workflow_clocks.execution_id, executionId)).run();
}
