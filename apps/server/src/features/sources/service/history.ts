/** @file Owns history within this feature. */

import type { sourceHistoryInputSchema, sourceHistoryRetireSchema } from '@study/contracts';
import { Effect } from 'effect';

import {
  SourceHistoryRetirementStore,
  SourceHistoryStore
} from '#server/features/sources/store/history';
import { Workflows } from '#server/features/workflows/index';
import { transaction, useStore } from '#server/platform/definitions/define-store';

export function* sourceHistoryOperations() {
  const histories = yield* useStore(SourceHistoryStore);

  return {
    previewHistory: (input: typeof sourceHistoryInputSchema.Type) => histories.sourceHistory(input),
    retireHistory: (input: typeof sourceHistoryRetireSchema.Type) =>
      transaction((tx) => {
        const preview = tx.store(SourceHistoryStore).sourceHistory(input);
        const { ids, inputIds } = tx
          .store(SourceHistoryRetirementStore)
          .retiredExtractionCorrelation({
            sourceId: input.sourceId,
            snapshotIds: preview.candidates.map((item) => item.snapshotId)
          });

        const executions = Workflows.retireCorrelations(tx, ids, [
          'SourceProcessingRequested',
          'SourceCorrectionRequested',
          'SourceIndexed',
          'SourceProcessingFailed'
        ]);
        // The retained output's content-free SourceIndexed event must remain dispatchable.
        const inputs = Workflows.retireCorrelations(tx, inputIds, ['SourceCorrectionRequested']);

        Workflows.scrubRetiredCorrelations(tx, ids);
        Workflows.scrubRetiredCorrectionInputs(tx, inputIds);
        const result = tx.store(SourceHistoryStore).retireSourceHistory(input);

        if (result.candidates.length) {
          const eventId = crypto.randomUUID();

          tx.emit({
            type: 'SourceHistoryPruned',
            eventId,
            causationId: null,
            correlationId: eventId,
            inputVersion: 1,
            depth: 0,
            sourceId: input.sourceId,
            snapshotIds: result.candidates.map((item) => item.snapshotId)
          });
        }

        return { result, executions: [...new Set([...executions, ...inputs])] };
      }).pipe(
        Effect.tap(({ executions }) => Workflows.interruptRetiredExecutions(executions)),
        Effect.map(({ result }) => result)
      )
  };
}
