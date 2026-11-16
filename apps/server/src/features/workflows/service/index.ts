/** @file Composes workflows application operations behind the feature boundary. */

import type { WorkflowEvent } from '@study/contracts';
import { StudyError, executionIdSchema } from '@study/contracts';
import { Effect, Option, Schema } from 'effect';

import { ExecutionStore } from '#server/features/workflows/store/index';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';
import { transaction } from '#server/platform/definitions/define-store';
import { WorkflowControl } from '#server/platform/workflows/control';
import { WorkflowRetirementStore } from '#server/platform/workflows/retirement';

import { makeWorkflows } from './executions.ts';
import { correlatedExecutions } from './retirement.ts';

export const Workflows = defineService('study/Workflows', makeWorkflows, {
  correlatedExecutions,
  executionInTransaction: (tx: Transaction, id: typeof executionIdSchema.Type) =>
    tx.store(ExecutionStore).execution(id),
  retireCorrelations: (
    tx: Transaction,
    ids: readonly string[],
    eventTypes: readonly WorkflowEvent['type'][]
  ) => tx.store(WorkflowRetirementStore).fence({ ids, eventTypes }),
  scrubRetiredCorrelations: (tx: Transaction, ids: readonly string[]) =>
    tx.store(WorkflowRetirementStore).scrub(ids),
  scrubRetiredCorrectionInputs: (tx: Transaction, ids: readonly string[]) =>
    tx.store(WorkflowRetirementStore).scrubCorrectionInputs(ids),
  cancelCorrelatedExecutions: Effect.fnUntraced(function* (requestId: string, workflow: string) {
    const runs = yield* transaction((tx) =>
      correlatedExecutions(tx, requestId).filter(
        (run) => run.workflow === workflow && run.canCancel
      )
    );

    if (!runs.length) return;

    const control = yield* Effect.serviceOption(WorkflowControl);

    if (Option.isNone(control))
      return yield* Effect.fail(
        new StudyError('unsupported', 'Native cancellation control is unavailable')
      );

    for (const run of runs) yield* control.value.cancel({ id: run.id, mode: 'safe' });
  }),
  interruptRetiredExecutions: Effect.fnUntraced(function* (ids: readonly string[]) {
    const control = yield* Effect.serviceOption(WorkflowControl);

    if (Option.isNone(control)) return;

    for (const id of ids)
      yield* control.value
        .cancel({ id: Schema.decodeUnknownSync(executionIdSchema)(id), mode: 'unsafe' })
        .pipe(Effect.ignore);
  })
});
