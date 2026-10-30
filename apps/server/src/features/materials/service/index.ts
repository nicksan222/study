import { randomUUID } from 'node:crypto';

import type { ErrorKind } from '@study/contracts/errors';
import type { SourceIndexed } from '@study/contracts/events';
import type { ProjectId } from '@study/contracts/ids';
import type * as input from '@study/contracts/materials/rpc';
import type {
  MaterialVersionDetailDto,
  materialGenerationInputSchema,
  materialGenerationPublicationSchema
} from '@study/contracts/materials/schemas';
import { Effect } from 'effect';

import {
  MaterialGenerationStore,
  MaterialsStore,
  MaterialVersionsStore,
  MaterialVersionExportStore,
  MaterialInputsStore,
  MaterialDependentsStore,
  MaterialCitationsStore
} from '#server/features/materials/store/index';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';
import {
  transaction,
  useStore,
  publicationTransaction
} from '#server/platform/definitions/define-store';

function* makeMaterials() {
  const generations = yield* useStore(MaterialGenerationStore),
    materials = yield* useStore(MaterialsStore),
    versions = yield* useStore(MaterialVersionsStore),
    versionExports = yield* useStore(MaterialVersionExportStore),
    inputs = yield* useStore(MaterialInputsStore),
    dependents = yield* useStore(MaterialDependentsStore),
    citations = yield* useStore(MaterialCitationsStore);
  const published = (tx: Transaction, version: MaterialVersionDetailDto) => {
    if (version.status !== 'published') return;

    const eventId = randomUUID();

    tx.emit({
      type: 'MaterialPublished',
      eventId,
      causationId: null,
      correlationId: eventId,
      inputVersion: 1,
      depth: 0,
      projectId: version.project_id,
      materialId: version.material_id,
      materialVersionId: version.id
    });
  };

  return {
    projectSource: (event: SourceIndexed) =>
      publicationTransaction((tx) => {
        const result = tx.store(MaterialsStore).projectSource(event);

        for (const [created, material] of [
          [result.originalCreated, result.original],
          [result.extractedCreated, result.extracted]
        ] as const) {
          if (created)
            tx.emit({
              type: 'MaterialPublished',
              eventId: randomUUID(),
              causationId: event.eventId,
              correlationId: event.correlationId,
              inputVersion: 1,
              depth: event.depth + 1,
              projectId: event.projectId,
              materialId: material.id,
              materialVersionId: material.version.id
            });
        }

        return { original: result.original, extracted: result.extracted };
      }),
    openGenerationScope: (value: { scopeId: string; projectId: ProjectId }) =>
      transaction((tx) => tx.store(MaterialGenerationStore).openScope(value)),
    closeGenerationScope: (value: { scopeId: string; projectId: ProjectId }) =>
      transaction((tx) => tx.store(MaterialGenerationStore).closeScope(value)),
    materialGeneration: generations.materialGeneration,
    publishMaterialGeneration: (value: typeof materialGenerationPublicationSchema.Type) =>
      publicationTransaction((tx) => {
        const result = materialIntegrity(() =>
          tx.store(MaterialGenerationStore).publishGeneration(value)
        );

        if (result.event && result.materialId !== undefined)
          tx.emit({
            type: 'MaterialPublished',
            eventId: randomUUID(),
            causationId: result.event.eventId,
            correlationId: result.event.correlationId,
            inputVersion: 1,
            depth: result.event.depth + 1,
            projectId: result.event.projectId,
            materialId: result.materialId,
            materialVersionId: result.versionId,
            generationRequestId: value.requestId
          });

        return result.versionId;
      }),
    retryMaterialGenerationOnce: (value: { requestId: string; retryId: string }) =>
      transaction((tx) => {
        const { request, created } = tx.store(MaterialGenerationStore).prepareRetry(value);

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
    material: materials.material,
    findMaterial: materials.findMaterial,
    materials: materials.materials,
    materialVersion: versions.materialVersion,
    materialVersionExport: versionExports.materialVersionExport,
    findMaterialVersion: versions.findMaterialVersion,
    materialVersions: versions.materialVersions,
    inputs: inputs.inputVersions,
    dependents: dependents.dependentVersions,
    citations: citations.citations,
    create: (value: typeof input.createInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).create(value);

        published(tx, result.version);

        return result;
      }),
    createVersion: (value: typeof input.createVersionInputSchema.Type) =>
      transaction((tx) => {
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
        const result = tx.store(MaterialsStore).publishVersion(value);

        published(tx, result);

        return result;
      }),
    replaceDraft: (value: typeof input.replaceDraftInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).replaceDraft(value);

        return result;
      }),
    setCitations: (value: typeof input.setCitationsInputSchema.Type) =>
      transaction((tx) => {
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

export const Materials = defineService('study/Materials', Effect.gen(makeMaterials));
