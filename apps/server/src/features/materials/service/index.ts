/** @file Composes materials application operations behind the feature boundary. */

import type * as input from '@study/contracts';
import type { ContentInput } from '@study/contracts';

import { MaterialBackupStore } from '#server/features/materials/store/backup';
import { MaterialGenerationStore, MaterialsStore } from '#server/features/materials/store/index';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';
import { transaction } from '#server/platform/definitions/define-store';

import { assertContentCitation, assertContentInputs, readContentInput } from './content-inputs.ts';
import { deletionParticipantsLayer, materialDeletionOperations } from './deletion.ts';
import { materialExportOperations } from './export.ts';
import { materialGenerationOperations } from './generation-requests.ts';
import { assertGenerationActive } from './generation.ts';
import { materialHistoryOperations } from './history.ts';
import { materialLibraryOperations } from './library.ts';

function* makeMaterials() {
  return {
    ...materialDeletionOperations(),
    ...materialHistoryOperations(),
    contentInput: (input: ContentInput) => transaction((tx) => readContentInput(tx, input)),
    ...materialGenerationOperations(),
    ...materialExportOperations(),
    ...(yield* materialLibraryOperations())
  };
}

export const Materials = defineService('study/Materials', makeMaterials, {
  attachInTransaction: (tx: Transaction, value: typeof input.attachInputSchema.Type) =>
    tx.store(MaterialsStore).attach(value),
  validateContentInputsInTransaction: assertContentInputs,
  validateBackup: (tx: Transaction) => {
    for (const version of tx.store(MaterialBackupStore).backupValidation(undefined)) {
      for (const input of version.inputs) readContentInput(tx, input, undefined, true);

      for (const citation of version.citations) assertContentCitation(tx, citation, true);
    }
  },
  readGeneration,
  deletionParticipantsLayer
});

/** Read the owned generation request within a cross-feature transaction. */

function readGeneration(tx: Transaction, value: { requestId: string; verifyOnly?: boolean }) {
  const request = tx.store(MaterialGenerationStore).materialGeneration(value);

  if (!value.verifyOnly && request.resultVersionId === null) assertGenerationActive(tx, request.id);

  return request;
}
