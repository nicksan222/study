/** @file Owns deletion within this feature. */

import type { SourceId } from '@study/contracts';
import { Effect } from 'effect';

import { SourceStore } from '#server/features/sources/store/index';
import {
  SourceDeletionPreviewStore,
  SourceRetirementStore
} from '#server/features/sources/store/retirement';
import { Workflows } from '#server/features/workflows/index';
import { transaction } from '#server/platform/definitions/define-store';

export function sourceDeletionOperations() {
  return {
    previewDeletion: ({ id }: { id: SourceId }) =>
      transaction((tx) => tx.store(SourceDeletionPreviewStore).sourceDeletion(id)),
    deleteSource: (input: { id: SourceId }) =>
      transaction((tx) => {
        const { ids } = tx.store(SourceRetirementStore).sourceRetirement(input.id);
        const deleted = tx.store(SourceStore).deleteSource(input.id);
        const executions = deleted
          ? Workflows.retireCorrelations(tx, ids, [
              'SourceProcessingRequested',
              'SourceCorrectionRequested',
              'SourceProcessingFailed',
              'SourceIndexed',
              'SourceProjectChanged'
            ])
          : [];

        if (deleted) Workflows.scrubRetiredCorrelations(tx, ids);

        if (deleted) {
          const eventId = crypto.randomUUID();

          tx.emit({
            type: 'SourceDeleted',
            eventId,
            causationId: null,
            correlationId: eventId,
            inputVersion: 1,
            depth: 0,
            sourceId: input.id
          });
        }

        return { deleted, executions };
      }).pipe(
        Effect.tap(({ executions }) => Workflows.interruptRetiredExecutions(executions)),
        Effect.map(({ deleted }) => deleted)
      )
  };
}
