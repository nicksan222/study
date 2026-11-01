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

import type { sessionSelectionTargetSchema } from '@study/contracts/conversations/context';
import { StudyError } from '@study/contracts/errors';
import type { ErrorKind } from '@study/contracts/errors';
import type { SourceIndexed } from '@study/contracts/events';
import type { ProjectId, SourceId } from '@study/contracts/ids';
import type * as editing from '@study/contracts/materials/editing';
import type * as input from '@study/contracts/materials/rpc';
import type {
  MaterialVersionDetailDto,
  materialGenerationInputSchema,
  materialGenerationPublicationSchema
} from '@study/contracts/materials/schemas';
import { Effect, Option } from 'effect';

import { DocumentEditingStore } from '#server/features/materials/store/document-editing';
import {
  DocumentProposalStore,
  DocumentProposalReceiptStore
} from '#server/features/materials/store/document-proposals';
import {
  MaterialSelectionStore,
  MaterialGenerationStore,
  MaterialsStore,
  MaterialVersionsStore,
  MaterialVersionExportStore,
  MaterialInputsStore,
  MaterialDependentsStore,
  MaterialCitationsStore
} from '#server/features/materials/store/index';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { Workflows } from '#server/features/workflows/index';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';
import {
  transaction,
  useStore,
  publicationTransaction
} from '#server/platform/definitions/define-store';
import { WorkflowControl } from '#server/platform/workflows/control';

import {
  requestDocumentTransform,
  publishDocumentTransform,
  retryDocumentTransform,
  assertDocumentContext
} from './document-transform.ts';
import { assertGenerationActive, emitGenerationPublication } from './generation.ts';

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
    versionExports = yield* useStore(MaterialVersionExportStore),
    inputs = yield* useStore(MaterialInputsStore),
    dependents = yield* useStore(MaterialDependentsStore),
    citations = yield* useStore(MaterialCitationsStore);

  const editDocument = (
    mutate: (tx: Transaction) => typeof editing.documentEditOutcomeSchema.Type
  ) =>
    transaction((tx) => {
      const result = mutate(tx);

      if (result.outcome === 'saved' && !result.replayed)
        published(
          tx,
          tx.store(MaterialVersionsStore).materialVersion({ id: result.submittedVersionId })
        );

      return result;
    });

  return {
    createManualDocument: (value: typeof editing.createManualDocumentSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(DocumentEditingStore).createManualDocument(value);

        published(tx, result.version);

        return result;
      }),
    saveDocument: (value: typeof editing.saveDocumentInputSchema.Type) =>
      editDocument((tx) => tx.store(DocumentEditingStore).saveDocument(value)),
    undoDocument: (value: typeof editing.undoDocumentInputSchema.Type) =>
      editDocument((tx) => tx.store(DocumentEditingStore).undoDocument(value)),
    compareDocument: (value: typeof editing.compareDocumentInputSchema.Type) =>
      transaction((tx) => tx.store(DocumentEditingStore).documentComparison(value)),
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
        }

        return { ...request, cancelled };
      }),
    cancelMaterialGeneration: (value: { requestId: string }) =>
      Effect.gen(function* () {
        const result = yield* transaction((tx) => {
          const request = tx.store(MaterialGenerationStore).cancelGeneration(value);

          return {
            request,
            runs:
              request.resultVersionId === null
                ? Workflows.correlatedExecutions(tx, request.id).filter(
                    (run) => run.workflow === 'material-generation/v1' && run.canCancel
                  )
                : []
          };
        });

        if (result.runs.length) {
          const control = yield* Effect.serviceOption(WorkflowControl);

          if (Option.isNone(control))
            return yield* Effect.fail(
              new StudyError('unsupported', 'Native cancellation control is unavailable')
            );

          for (const run of result.runs) yield* control.value.cancel({ id: run.id, mode: 'safe' });
        }

        return result.request;
      }),
    publishMaterialGeneration: (value: typeof materialGenerationPublicationSchema.Type) =>
      publicationTransaction((tx) => {
        const request = tx
          .store(MaterialGenerationStore)
          .materialGeneration({ requestId: value.requestId, verifyOnly: true });

        if (request.documentTransform)
          throw new StudyError(
            'invalid_input',
            'Session publication requires captured context coordination'
          );

        if (request.resultVersionId === null) assertGenerationActive(tx, request.id);

        const result = materialIntegrity(() =>
          tx.store(MaterialGenerationStore).publishGeneration(value)
        );

        emitGenerationPublication(tx, value.requestId, result);

        return result.versionId;
      }),
    retryMaterialGenerationOnce: (value: { requestId: string; retryId: string }) =>
      transaction((tx) => {
        const { request, created } = tx.store(MaterialGenerationStore).prepareRetry(value);

        if (request.resultVersionId === null) assertGenerationActive(tx, request.id);

        if (request.documentTransform)
          throw new StudyError(
            'invalid_input',
            'Session retry requires captured context coordination'
          );

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

export const Materials = defineService('study/Materials', Effect.gen(makeMaterials), {
  resolveSessionSelection,
  readGeneration,
  requestDocumentTransform,
  publishDocumentTransform,
  retryDocumentTransform,
  assertDocumentContext,
  registerImportedSource,
  assignImportedSourceProject,
  documentProposal,
  applyDocumentProposal,
  keepDocumentProposal,
  compareDocumentProposal,
  findDocumentProposalReceipt
});

/** Register acquisition in its caller's synchronous transaction, including the outbox event. */
function registerImportedSource(tx: Transaction, sourceId: SourceId) {
  const result = tx.store(MaterialsStore).registerSource(sourceId);

  if (result.originalCreated) published(tx, result.original.version);

  return result.original;
}

/** Apply an explicit organization instruction immediately, including pending imports. */
function assignImportedSourceProject(tx: Transaction, sourceId: SourceId) {
  tx.store(MaterialsStore).assignSourceProject(sourceId);
}

/** Resolve exact published content inside the caller's synchronous capture transaction. */
function resolveSessionSelection(
  tx: Transaction,
  target: typeof sessionSelectionTargetSchema.Type
) {
  return tx.store(MaterialSelectionStore).materialSelection(target);
}

/** Read the owned generation request within a cross-feature transaction. */
function readGeneration(tx: Transaction, value: { requestId: string; verifyOnly?: boolean }) {
  const request = tx.store(MaterialGenerationStore).materialGeneration(value);

  if (!value.verifyOnly && request.resultVersionId === null) assertGenerationActive(tx, request.id);

  return request;
}

/** Proposal participants run in Conversations' availability checked transaction. */
function documentProposal(tx: Transaction, value: typeof editing.proposalKeySchema.Type) {
  return tx.store(DocumentProposalStore).documentProposal(value);
}

function applyDocumentProposal(
  tx: Transaction,
  value: typeof editing.applyDocumentProposalSchema.Type,
  relevantValid: boolean
) {
  const result = tx.store(DocumentProposalStore).applyDocumentProposal({ ...value, relevantValid });

  emitProposalPublication(tx, result);

  return result;
}

function keepDocumentProposal(
  tx: Transaction,
  value: typeof editing.keepDocumentProposalSchema.Type
) {
  const result = tx.store(DocumentProposalStore).keepDocumentProposal(value);

  emitProposalPublication(tx, result);

  return result;
}

function compareDocumentProposal(tx: Transaction, value: typeof editing.proposalKeySchema.Type) {
  const proposal = documentProposal(tx, value);

  const base = tx.store(MaterialVersionsStore).materialVersion({ id: proposal.baseVersionId });

  const material = tx.store(MaterialsStore).material({ id: base.material_id });

  return tx.store(DocumentEditingStore).documentComparison({
    beforeVersionId: proposal.baseVersionId,
    proposedVersionId: proposal.proposedVersionId,
    currentVersionId: material.latestPublishedVersion!.id
  });
}

function emitProposalPublication(
  tx: Transaction,
  result: typeof editing.documentProposalOutcomeSchema.Type
) {
  if (result.replayed || result.resultVersionId === null) return;

  published(tx, tx.store(MaterialVersionsStore).materialVersion({ id: result.resultVersionId }));
}

/** Receipt replay performs no new publication and survives session disappearance. */
function findDocumentProposalReceipt(
  tx: Transaction,
  value:
    | typeof editing.applyDocumentProposalSchema.Type
    | typeof editing.keepDocumentProposalSchema.Type,
  operation: 'apply' | 'keep'
) {
  if (operation === 'apply') {
    if (!('baseVersionId' in value))
      throw new StudyError('invalid_input', 'Application requires exact captured identities');

    return tx
      .store(DocumentProposalReceiptStore)
      .findDocumentProposalReceipt({ ...value, operation: 'apply' });
  }

  return tx
    .store(DocumentProposalReceiptStore)
    .findDocumentProposalReceipt({ ...value, operation: 'keep' });
}
