/** @file Owns deletion within this feature. */

import type { ErrorKind, NoteId, noteDeletionSchema } from '@study/contracts';
import { Option } from 'effect';

import { NoteAssistantStore } from '#server/features/notes/store/assistant';
import {
  NoteDeletionCorrelationStore,
  NoteDeletionOwnershipStore,
  NoteDeletionStore
} from '#server/features/notes/store/deletion';
import { Pages } from '#server/features/pages/index';
import { Workflows } from '#server/features/workflows/index';
import type { Transaction } from '#server/platform/definitions/define-store';
import { publicationTransaction, transaction } from '#server/platform/definitions/define-store';

function deletionCorrelations(tx: Transaction, id: NoteId) {
  return tx.store(NoteDeletionCorrelationStore).deletionCorrelation(id).correlations;
}

function emitDeletion(tx: Transaction, value: typeof noteDeletionSchema.Type) {
  tx.emit({
    type: 'NoteDeletionRequested',
    eventId: `${value.operationId}/${value.attempt}`,
    causationId: null,
    correlationId: value.operationId,
    inputVersion: 1,
    depth: 0,
    noteId: value.noteId,
    attempt: value.attempt
  });
}

/** Source extraction and MaterialPublished notifications have independent library ownership. */

const deletionEventTypes = [
  'PageGenerationRequested',
  'PageGenerationFailed',
  'PagePublished',
  'NoteGenerationRequested',
  'NoteTitleRequested',
  'TransformSuggestionRequested',
  'NoteQuestionRequested',
  'RecordingPostRequested',
  'MaterialGenerationRequested',
  'MaterialGenerationFailed'
] as const;

export function noteDeletionOperations() {
  return {
    noteDeletionExecutions: (id: NoteId) =>
      transaction((tx) =>
        Workflows.retireCorrelations(tx, deletionCorrelations(tx, id), deletionEventTypes)
      ),
    noteDeletion: (id: NoteId) => transaction((tx) => tx.store(NoteDeletionStore).noteDeletion(id)),
    retryNoteDeletion: (id: NoteId) =>
      transaction((tx) => {
        const previous = tx.store(NoteDeletionStore).noteDeletion(id);

        const runs = Workflows.correlatedExecutions(
          tx,
          previous.operationId,
          `${previous.operationId}/${previous.attempt}`
        );

        const pendingTerminal =
          runs.length > 0 &&
          runs.every((run) => run.status === 'completed' || run.status === 'cancelled');

        const result = tx.store(NoteDeletionStore).retry({ noteId: id, pendingTerminal });

        if (result.attempt !== previous.attempt) emitDeletion(tx, result);

        return result;
      }),
    finishNoteDeletion: (value: { noteId: NoteId; attempt: number }) =>
      publicationTransaction((tx) => {
        const status = tx.store(NoteDeletionStore).noteDeletion(value.noteId);

        if (status.status === 'completed' || status.attempt !== value.attempt) return status;

        Workflows.scrubRetiredCorrelations(tx, deletionCorrelations(tx, value.noteId));

        return tx.store(NoteDeletionStore).settle({ ...value, errorKind: null });
      }),
    failNoteDeletion: (value: { noteId: NoteId; errorKind: ErrorKind; attempt: number }) =>
      transaction((tx) => tx.store(NoteDeletionStore).settle(value)),
    deleteNote: (id: NoteId) =>
      transaction((tx) => {
        const existing = tx.store(NoteDeletionStore).findNoteDeletion(id);

        if (Option.isSome(existing)) return existing.value;

        const child = tx.store(NoteAssistantStore).findNoteAssistant(id);
        const ownership = (Option.isSome(child) ? [id, child.value] : [id]).map((noteId) =>
          tx.store(NoteDeletionOwnershipStore).deletionOwnership(noteId)
        );
        const owned = {
          contextIds: ownership.flatMap((value) => value.contextIds),
          correlations: ownership.flatMap((value) => value.correlations)
        };

        const status = tx
          .store(NoteDeletionStore)
          .accept({ noteId: id, operationId: crypto.randomUUID() });

        const generations = Pages.prepareNoteRetirement(tx, {
          noteId: id,
          contextIds: owned.contextIds
        });

        tx.store(NoteDeletionStore).retainCorrelations({
          noteId: id,
          correlations: [...owned.correlations, ...generations]
        });

        Workflows.retireCorrelations(
          tx,
          [...owned.correlations, ...generations],
          deletionEventTypes
        );
        tx.store(NoteDeletionStore).retireCaptures(owned.contextIds);
        tx.store(NoteDeletionStore).removeNote(id);
        emitDeletion(tx, status);

        return status;
      })
  };
}
