/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Owns domain admission state and scoped publication authority.                      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks durable generation and cancellation before domain publication.                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Official Effect infrastructure owns scheduling and execution persistence independently.  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts';
import type { Db, DbTransaction } from '@study/db';
import { and, eq, sql } from '@study/db';
import {
  workflow_agent_progress,
  workflow_executions,
  workflow_retired_executions
} from '@study/db';

import type { ServerContext, ServerTransactionContext } from '#server/platform/database/context';

export function workflowStore(context: ServerContext | ServerTransactionContext) {
  const db = context.db.orm;
  const execution = (id: string) =>
    db.select().from(workflow_executions).where(eq(workflow_executions.execution_id, id)).get();
  const retired = (id: string) =>
    !!db
      .select()
      .from(workflow_retired_executions)
      .where(eq(workflow_retired_executions.execution_id, id))
      .get();

  function assertPublication(id: string, generation: number) {
    const row = execution(id);

    if (
      !row ||
      Number(row.generation) !== Number(generation) ||
      row.cancellation_mode !== null ||
      !['running', 'suspended'].includes(row.status) ||
      retired(id)
    )
      throw new StudyError('cancelled', 'Workflow publication is no longer active');
  }

  return {
    execution,
    retired,
    assertPublication,
    capturePublication(id: string) {
      const row = execution(id);

      if (!row) throw new StudyError('not_found', 'Workflow execution missing');

      assertPublication(id, row.generation);

      return Number(row.generation);
    },
    requestCancellation(id: string, mode: 'safe' | 'unsafe') {
      return context.transaction(['workflows'], (tx) => {
        const row = workflowStore(tx).execution(id);

        if (!row || row.status === 'completed' || row.status === 'cancelled') return;

        if (
          row.status === 'cancelling' &&
          (row.cancellation_mode === mode || row.cancellation_mode === 'unsafe')
        )
          return;

        tx.db.orm
          .update(workflow_executions)
          .set({
            status: 'cancelling',
            cancellation_mode: row.cancellation_mode === 'unsafe' ? 'unsafe' : mode
          })
          .where(eq(workflow_executions.execution_id, id))
          .run();
      });
    },
    completeCancellation(id: string) {
      context.transaction(['workflows'], (tx) => {
        tx.db.orm
          .update(workflow_executions)
          .set({ status: 'cancelled' })
          .where(
            and(
              eq(workflow_executions.execution_id, id),
              eq(workflow_executions.status, 'cancelling')
            )
          )
          .run();
      });
    }
  };
}

/** Retain cancellation authority while removing domain-captured private inputs. */
export function scrubRetiredExecution(db: Db | DbTransaction, executionId: string) {
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
    .set({
      payload: '{}',
      result: null,
      status: sql`CASE WHEN status IN ('completed', 'cancelled') THEN status ELSE 'cancelling' END`,
      cancellation_mode: sql`CASE WHEN status IN ('completed', 'cancelled') THEN cancellation_mode ELSE 'unsafe' END`
    })
    .where(eq(workflow_executions.execution_id, executionId))
    .run();
}

export const scrubRetiredCorrectionExecution = scrubRetiredExecution;
