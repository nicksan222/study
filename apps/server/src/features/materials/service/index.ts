/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates material creation, versioning, links, citations, and generation        │
 * │ through feature-owned stores.                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns public material behavior and coordinates private persistence with workflows.      │
 * │ - Coordinates typed failures and persistence effects for feature callers.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This is the materials feature boundary for RPC and workflow callers; store               │
 * │ implementations stay private to the service.                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import type { ErrorKind } from '@study/contracts/errors';
import type { ProjectId } from '@study/contracts/ids';
import type { ContentInput } from '@study/contracts/inputs';
import type { exportMaterialVersionInputSchema } from '@study/contracts/materials/export';
import type * as input from '@study/contracts/materials/rpc';
import type {
  MaterialVersionDetailDto,
  materialGenerationInputSchema,
  materialGenerationPublicationSchema
} from '@study/contracts/materials/schemas';
import type { SearchProjectionPageInput } from '@study/contracts/search/schemas';
import { Effect } from 'effect';

import {
  MaterialBackupStore,
  MaterialPendingBackupStore
} from '#server/features/materials/store/backup';
import { MaterialExportCitationsStore } from '#server/features/materials/store/export';
import {
  MaterialActiveGenerationsStore,
  MaterialGenerationStore,
  MaterialsStore,
  MaterialVersionsStore,
  MaterialCitationsStore
} from '#server/features/materials/store/index';
import { MaterialSearchStore } from '#server/features/materials/store/search';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { Workflows } from '#server/features/workflows/index';
import { exportBudget } from '#server/platform/content-export/budget';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';
import {
  transaction,
  useStore,
  publicationTransaction
} from '#server/platform/definitions/define-store';

import { assertContentInputs, assertContentCitation, readContentInput } from './content-inputs.ts';
import { materialDeletionOperations, deletionParticipantsLayer } from './deletion.ts';
import { serializeMaterialVersion } from './export-serializer.ts';
import { assertGenerationActive, emitGenerationPublication } from './generation.ts';
import { materialHistoryOperations } from './history.ts';

function published(tx: Transaction, version: MaterialVersionDetailDto) {
  if (version.status !== 'published') return;

  const eventId = randomUUID();

  tx.emit({
    type: 'MaterialPublished',
    eventId,
    causationId: null,
    correlationId: eventId,
    inputVersion: 1,
    depth: 0,
    materialId: version.material_id,
    materialVersionId: version.id
  });
}

function* makeMaterials() {
  const materials = yield* useStore(MaterialsStore),
    versions = yield* useStore(MaterialVersionsStore),
    citations = yield* useStore(MaterialCitationsStore);

  return {
    ...materialDeletionOperations(),
    ...materialHistoryOperations(),
    openGenerationScope: (value: { scopeId: string; projectId: ProjectId }) =>
      transaction((tx) => tx.store(MaterialGenerationStore).openScope(value)),
    closeGenerationScope: (value: { scopeId: string; projectId: ProjectId }) =>
      transaction((tx) => tx.store(MaterialGenerationStore).closeScope(value)),
    contentInput: (input: ContentInput) => transaction((tx) => readContentInput(tx, input)),
    activeMaterialGenerations: (value: { projectId?: ProjectId }) =>
      transaction((tx) =>
        tx
          .store(MaterialActiveGenerationsStore)
          .activeGenerations(value)
          .filter(
            (request) =>
              !Workflows.correlatedExecutions(tx, request.id).some(
                (run) =>
                  run.workflow === 'material-generation/v1' &&
                  (run.status === 'cancelled' || run.status === 'cancelling')
              )
          )
      ),
    materialGeneration: (value: { requestId: string; eventId?: string; verifyOnly?: boolean }) =>
      transaction((tx) => {
        const request = tx.store(MaterialGenerationStore).materialGeneration(value);

        const cancelled =
          request.resultVersionId === null &&
          (request.cancelled ||
            Workflows.correlatedExecutions(tx, request.id).some(
              (run) =>
                run.workflow === 'material-generation/v1' &&
                (run.status === 'cancelled' || run.status === 'cancelling')
            ));

        if (!value.verifyOnly && request.resultVersionId === null) {
          assertGenerationActive(tx, request.id);
          assertContentInputs(tx, request.inputs, request.projectId, true);
        }

        return { ...request, cancelled };
      }),
    cancelMaterialGeneration: (value: { requestId: string }) =>
      Effect.gen(function* () {
        const request = yield* transaction((tx) =>
          tx.store(MaterialGenerationStore).cancelGeneration(value)
        );

        if (request.resultVersionId === null)
          yield* Workflows.cancelCorrelatedExecutions(request.id, 'material-generation/v1');

        return request;
      }),
    publishMaterialGeneration: (value: typeof materialGenerationPublicationSchema.Type) =>
      publicationTransaction((tx) => {
        const request = tx
          .store(MaterialGenerationStore)
          .materialGeneration({ requestId: value.requestId, verifyOnly: true });

        if (request.resultVersionId === null) {
          assertGenerationActive(tx, request.id);
          assertContentInputs(tx, request.inputs, request.projectId, true);
        }

        const result = materialIntegrity(() =>
          tx.store(MaterialGenerationStore).publishGeneration({
            ...value,
            inputSnapshots:
              request.resultVersionId === null
                ? assertContentInputs(tx, request.inputs, request.projectId, true)
                : []
          })
        );

        emitGenerationPublication(tx, value.requestId, result);

        return result.versionId;
      }),
    retryMaterialGenerationOnce: (value: { requestId: string; retryId: string }) =>
      transaction((tx) => {
        const { request, created } = tx.store(MaterialGenerationStore).prepareRetry(value);

        if (request.resultVersionId === null) {
          assertGenerationActive(tx, request.id);
          assertContentInputs(tx, request.inputs, request.projectId, true);
        }

        if (created)
          tx.emit({
            type: 'MaterialGenerationRequested',
            eventId: value.retryId,
            causationId: null,
            correlationId: request.id,
            inputVersion: 1,
            depth: 0,
            requestId: request.id,
            projectId: request.projectId,
            kind: request.kind
          });

        return request;
      }),
    notifyMaterialGenerationFailed: (value: {
      requestId: string;
      generationEventId: string;
      errorKind: ErrorKind;
    }) =>
      publicationTransaction((tx) => {
        const { request, event, failureId, created } = tx
          .store(MaterialGenerationStore)
          .prepareFailure(value);

        if (created)
          tx.emit({
            type: 'MaterialGenerationFailed',
            eventId: failureId,
            causationId: event.eventId,
            correlationId: request.id,
            inputVersion: 1,
            depth: event.depth + 1,
            requestId: request.id,
            projectId: request.projectId,
            kind: request.kind,
            generationEventId: event.eventId,
            errorKind: value.errorKind
          });
      }),
    requestMaterialGeneration: (value: typeof input.requestMaterialGenerationInputSchema.Type) =>
      transaction((tx) => {
        const requestId = randomUUID();

        assertContentInputs(tx, value.inputs, value.projectId, true);

        const result = tx.store(MaterialGenerationStore).request({ requestId, request: value });

        tx.emit({
          type: 'MaterialGenerationRequested',
          eventId: requestId,
          causationId: null,
          correlationId: requestId,
          inputVersion: 1,
          depth: 0,
          requestId,
          projectId: result.projectId,
          kind: result.kind
        });

        return result;
      }),
    requestMaterialGenerationAttemptOnce: (value: {
      requestId: string;
      generationEventId: string;
      request: typeof materialGenerationInputSchema.Type;
    }) =>
      transaction((tx) => {
        assertContentInputs(tx, value.request.inputs, value.request.projectId, true);
        const initial = tx.store(MaterialGenerationStore).requestOnce(value);

        const prepared =
          initial.created || value.generationEventId === value.requestId
            ? { request: initial.request, created: initial.created }
            : tx
                .store(MaterialGenerationStore)
                .prepareRetry({ requestId: value.requestId, retryId: value.generationEventId });

        if (prepared.created)
          tx.emit({
            type: 'MaterialGenerationRequested',
            eventId: value.generationEventId,
            causationId: null,
            correlationId: value.requestId,
            inputVersion: 1,
            depth: 0,
            requestId: value.requestId,
            projectId: prepared.request.projectId,
            kind: prepared.request.kind
          });

        return prepared.request;
      }),
    requestMaterialGenerationOnce: (value: {
      requestId: string;
      request: typeof materialGenerationInputSchema.Type;
    }) =>
      transaction((tx) => {
        assertContentInputs(tx, value.request.inputs, value.request.projectId, true);
        const { request, created } = tx.store(MaterialGenerationStore).requestOnce(value);

        if (created)
          tx.emit({
            type: 'MaterialGenerationRequested',
            eventId: request.id,
            causationId: null,
            correlationId: request.id,
            inputVersion: 1,
            depth: 0,
            requestId: request.id,
            projectId: request.projectId,
            kind: request.kind
          });

        return request;
      }),
    exportMaterialVersion: (value: typeof exportMaterialVersionInputSchema.Type) =>
      transaction((tx) => {
        const version = tx.store(MaterialVersionsStore).materialVersion({ id: value.id });

        exportBudget().consume(version);
        const budget = exportBudget();

        budget.consume({ version, citations: [] });
        const exportedCitations = tx.store(MaterialExportCitationsStore).exportCitationSnapshot({
          id: value.id,
          budget: budget.remaining()
        }).citations;

        return serializeMaterialVersion(version, value.format, exportedCitations);
      }),
    material: materials.material,
    findMaterial: materials.findMaterial,
    materials: materials.materials,
    materialVersion: versions.materialVersion,
    findMaterialVersion: versions.findMaterialVersion,
    materialVersions: versions.materialVersions,
    citations: citations.citations,
    create: (value: typeof input.createInputSchema.Type) =>
      transaction((tx) => {
        assertContentInputs(tx, value.inputs ?? [], value.projectId);
        const result = tx.store(MaterialsStore).create(value);

        published(tx, result.version);

        return result;
      }),
    createVersion: (value: typeof input.createVersionInputSchema.Type) =>
      transaction((tx) => {
        assertContentInputs(tx, value.inputs ?? []);
        const result = tx.store(MaterialsStore).createVersion(value);

        published(tx, result);

        return result;
      }),
    archive: (value: typeof input.archiveInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).archive(value);

        return result;
      }),
    unarchive: (value: typeof input.unarchiveInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).unarchive(value);

        return result;
      }),
    updateDescription: (value: typeof input.updateDescriptionInputSchema.Type) =>
      transaction((tx) => tx.store(MaterialsStore).updateDescription(value)),
    rename: (value: typeof input.renameInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).rename(value);

        return result;
      }),
    deleteDraft: (value: typeof input.deleteDraftInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).deleteDraft(value);

        return result;
      }),
    publishVersion: (value: typeof input.publishVersionInputSchema.Type) =>
      transaction((tx) => {
        const pending = tx.store(MaterialVersionsStore).materialVersion({ id: value.id });

        assertContentInputs(tx, pending.inputs);
        const result = tx.store(MaterialsStore).publishVersion(value);

        published(tx, result);

        return result;
      }),
    replaceDraft: (value: typeof input.replaceDraftInputSchema.Type) =>
      transaction((tx) => {
        assertContentInputs(tx, value.inputs ?? []);
        const result = tx.store(MaterialsStore).replaceDraft(value);

        return result;
      }),
    setCitations: (value: typeof input.setCitationsInputSchema.Type) =>
      transaction((tx) => {
        for (const citation of value.citations) assertContentCitation(tx, citation);

        const result = tx.store(MaterialsStore).setCitations(value);

        return result;
      }),
    attach: (value: typeof input.attachInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).attach(value);

        return result;
      }),
    detach: (value: typeof input.detachInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).detach(value);

        return result;
      }),
    reorder: (value: typeof input.reorderInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).reorder(value);

        return result;
      })
  };
}

export const Materials = defineService('study/Materials', Effect.gen(makeMaterials), {
  searchProjectionsInTransaction: (tx: Transaction, input: SearchProjectionPageInput) =>
    tx.store(MaterialSearchStore).searchProjectionPages(input),
  validateContentInputsInTransaction: assertContentInputs,
  prepareBackup: (tx: Transaction) => {
    for (const requestId of tx.store(MaterialPendingBackupStore).pendingGenerations(undefined))
      tx.store(MaterialGenerationStore).cancelGeneration({ requestId });
  },
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
