/** @file Owns retirement within this feature. */

import type * as r from '@study/contracts';
import type { PageVersionId } from '@study/contracts';
import { StudyError, executionIdSchema } from '@study/contracts';
import { transaction, WorkflowControl } from '@study/server';
import type { Transaction } from '@study/server';
import { Effect, Option, Schema } from 'effect';

import { PageBodyRetirementStore } from '#server/features/pages/store/body-retirement';
import {
  PageDeletionStore,
  PageHistoryStore,
  PagesStore
} from '#server/features/pages/store/index';
import { Workflows } from '#server/features/workflows/index';

/** Canonical retirement and private native retirement share one rollback boundary. */
function retireBodyWorkflows(tx: Transaction, ids: readonly PageVersionId[]) {
  const { ids: correlations } = tx.store(PageBodyRetirementStore).bodyRetirementCorrelation(ids);

  const executions = Workflows.retireCorrelations(tx, correlations, [
    'PageGenerationRequested',
    'PageGenerationFailed'
  ]);

  Workflows.scrubRetiredCorrelations(tx, correlations);

  return executions;
}

/** Await private execution cleanup after the retirement transaction has committed. */
function afterBodyRetirement<A, E, R>(
  effect: Effect.Effect<{ readonly executions: readonly string[]; readonly result: A }, E, R>
) {
  return effect.pipe(
    Effect.tap(({ executions }) => finishBodyRetirement(executions)),
    Effect.map(({ result }) => result)
  );
}

function finishBodyRetirement(ids: readonly string[]) {
  return Effect.gen(function* () {
    if (!ids.length) return;

    const control = yield* Effect.serviceOption(WorkflowControl);

    if (Option.isNone(control))
      return yield* Effect.fail(
        new StudyError('unsupported', 'Native retirement control is unavailable')
      );

    for (const id of ids)
      yield* control.value.cancel({
        id: Schema.decodeUnknownSync(executionIdSchema)(id),
        mode: 'unsafe'
      });
  });
}

export function pageRetirementOperations() {
  return {
    retireHistory: (v: typeof r.retireSchema.Type) =>
      transaction((tx) => {
        const preview = tx.store(PageHistoryStore).previewHistory(v);

        const executions = retireBodyWorkflows(tx, preview.versionIds);

        return { executions, result: tx.store(PagesStore).retireHistory(v) };
      }).pipe(afterBodyRetirement),
    delete: (v: typeof r.deleteSchema.Type) =>
      transaction((tx) => {
        const preview = tx.store(PageDeletionStore).previewDeletion({ id: v.pageId });

        const executions = retireBodyWorkflows(tx, preview.versionIds);

        return { executions, result: tx.store(PagesStore).delete(v) };
      }).pipe(afterBodyRetirement)
  };
}
