/** @file Owns generation requests within this feature. */

import type * as input from '@study/contracts';
import type {
  ErrorKind,
  ProjectId,
  materialGenerationInputSchema,
  materialGenerationHistoryReferencesSchema,
  materialGenerationPublicationSchema
} from '@study/contracts';
import { publicationTransaction, transaction } from '@study/server';
import { Effect } from 'effect';

import {
  MaterialActiveGenerationsStore,
  MaterialGenerationStore
} from '#server/features/materials/store/index';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { Workflows } from '#server/features/workflows/index';

import { assertContentInputs } from './content-inputs.ts';
import { assertGenerationActive, emitGenerationPublication } from './generation.ts';

export function materialGenerationOperations() {
  return {
    materialGenerationHistory: (value: {
      requestId: string;
      snapshot?: typeof materialGenerationHistoryReferencesSchema.Type;
    }) =>
      transaction((tx) => {
        assertGenerationActive(tx, value.requestId);
        const store = tx.store(MaterialGenerationStore);
        const request = store.materialGeneration(value);

        assertContentInputs(tx, request.inputs, request.projectId, true);

        return store.generationHistory({ request, snapshot: value.snapshot });
      }),
    openGenerationScope: (value: { scopeId: string; projectId: ProjectId }) =>
      transaction((tx) => tx.store(MaterialGenerationStore).openScope(value)),
    closeGenerationScope: (value: { scopeId: string; projectId: ProjectId }) =>
      transaction((tx) => tx.store(MaterialGenerationStore).closeScope(value)),
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
    cancelMaterialGeneration: Effect.fnUntraced(function* (value: { requestId: string }) {
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
        const requestId = crypto.randomUUID();

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
      })
  };
}
