/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates independent authored Document operations through transactional stores. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Coordinates independent authored Document operations through transactional stores.     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy coordinates public services and private stores within caller-owned        │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import type * as e from '@study/contracts/documents/editing';
import type * as evidence from '@study/contracts/documents/evidence';
import type { exportDocumentInputSchema } from '@study/contracts/documents/export';
/** Documents alone owns authored publication. Workflow callers supply their Activity fence. */
import type * as r from '@study/contracts/documents/rpc';
import type * as t from '@study/contracts/documents/transform';
import type { StudyDocument } from '@study/contracts/documents/types';
import { StudyError } from '@study/contracts/errors';
import type { SessionId } from '@study/contracts/ids';
import type { StudyDocumentVersionId } from '@study/contracts/ids';
import { Effect, Option } from 'effect';

import {
  DocumentAnnotationsStore,
  DocumentAnnotationHistoryStore
} from '#server/features/documents/store/annotations';
import { DocumentBackupStore } from '#server/features/documents/store/backup';
import { DocumentBodyRetirementStore } from '#server/features/documents/store/body-retirement';
import {
  DocumentsStore,
  DocumentProposalsStore,
  DocumentProposalReceiptsStore,
  DocumentVersionsStore,
  DocumentComparisonsStore,
  DocumentExportsStore,
  DocumentHistoryStore,
  DocumentDeletionStore
} from '#server/features/documents/store/index';
import { DocumentTransformsStore } from '#server/features/documents/store/transforms';
import { Sources } from '#server/features/sources/index';
import { Workflows } from '#server/features/workflows/index';
import { defineService } from '#server/platform/definitions/define-service';
import {
  useStore,
  transaction,
  publicationTransaction
} from '#server/platform/definitions/define-store';
import type { Transaction } from '#server/platform/definitions/define-store';

import { assessCitation, citationAssessments } from './assessments.ts';
import { serializeDocumentVersion } from './export-serializer.ts';
import { requestTransform, publishTransform, retryTransform } from './transforms.ts';

function documentPublished(tx: Transaction, versionId: StudyDocumentVersionId) {
  const eventId = randomUUID();

  tx.emit({
    type: 'DocumentPublished',
    eventId,
    causationId: null,
    correlationId: eventId,
    inputVersion: 1,
    depth: 0,
    versionId
  });
}

function created(tx: Transaction, result: { document: StudyDocument; replayed: boolean }) {
  if (!result.replayed && result.document.version)
    documentPublished(tx, result.document.version.id);

  return result.document;
}

function edited(tx: Transaction, result: typeof e.editOutcomeSchema.Type) {
  if (!result.replayed && result.outcome === 'saved')
    documentPublished(tx, result.submittedVersionId);

  return result;
}

function proposalCommitted(tx: Transaction, result: typeof e.proposalOutcomeSchema.Type) {
  if (!result.replayed && result.resultVersionId !== null)
    documentPublished(tx, result.resultVersionId);

  return result;
}

function annotationChanged(tx: Transaction, result: typeof evidence.annotationOutcomeSchema.Type) {
  if (result.outcome === 'saved') {
    const eventId = randomUUID();

    tx.emit({
      type: 'DocumentAnnotationChanged',
      eventId,
      causationId: null,
      correlationId: eventId,
      inputVersion: 1,
      depth: 0,
      documentId: result.annotation.target.documentId,
      annotationId: result.annotation.id,
      revision: result.annotation.revision
    });
  }

  return result;
}

export const Documents = defineService(
  'study/Documents',
  Effect.gen(function* () {
    const docs = yield* useStore(DocumentsStore);
    const transforms = yield* useStore(DocumentTransformsStore);
    const proposals = yield* useStore(DocumentProposalsStore);
    const annotations = yield* useStore(DocumentAnnotationsStore);
    const annotationHistory = yield* useStore(DocumentAnnotationHistoryStore);
    const versions = yield* useStore(DocumentVersionsStore);
    const comparisons = yield* useStore(DocumentComparisonsStore);
    const exports = yield* useStore(DocumentExportsStore);
    const history = yield* useStore(DocumentHistoryStore);
    const deletion = yield* useStore(DocumentDeletionStore);

    return {
      ...docs,
      assessCitation: (v: typeof evidence.assessCitationSchema.Type) =>
        transaction((tx) => assessCitation(tx, v)),
      assessments: (v: typeof evidence.assessmentsInputSchema.Type) =>
        transaction((tx) => citationAssessments(tx, v)),
      transform: transforms.transform,
      cancelTransform: (v: typeof t.transformKeySchema.Type) =>
        Effect.gen(function* () {
          const request = yield* transaction((tx) =>
            tx
              .store(DocumentTransformsStore)
              .changeTransform({ ...v, cancel: true, errorKind: null })
          );

          if (request.resultVersionId === null)
            yield* Workflows.cancelCorrelatedExecutions(request.id, 'document-transform/v1');

          return request;
        }),
      failTransform: (v: {
        requestId: string;
        eventId: string;
        errorKind: typeof t.transformSnapshotSchema.Type.errorKind;
      }) =>
        publicationTransaction((tx) => {
          const old = tx.store(DocumentTransformsStore).transform(v);

          if (old.eventId !== v.eventId || old.cancelled || old.resultVersionId !== null) return;

          tx.store(DocumentTransformsStore).changeTransform({ ...v, cancel: false });
          tx.emit({
            type: 'DocumentGenerationFailed',
            eventId: `document-failed/${v.eventId}`,
            causationId: v.eventId,
            correlationId: v.requestId,
            inputVersion: 1,
            depth: 1,
            requestId: v.requestId,
            generationEventId: v.eventId,
            errorKind: v.errorKind ?? 'internal'
          });
        }),
      proposal: proposals.proposal,
      compareProposal: (v: typeof e.proposalKeySchema.Type) =>
        transaction((tx) => {
          const p = tx.store(DocumentProposalsStore).proposal(v);

          return tx.store(DocumentComparisonsStore).comparison({
            beforeVersionId: p.baseVersionId,
            proposedVersionId: p.proposedVersionId,
            currentVersionId: p.currentVersionId
          });
        }),
      applyProposal: (v: typeof e.applyProposalSchema.Type) =>
        transaction((tx) => {
          if (Option.isSome(tx.store(DocumentTransformsStore).findTransform(v)))
            throw new StudyError(
              'unsupported',
              'Session proposal application requires captured context coordination'
            );

          return proposalCommitted(tx, tx.store(DocumentProposalsStore).applyProposal(v));
        }),
      keepProposal: (v: typeof e.keepProposalSchema.Type) =>
        transaction((tx) => {
          if (Option.isSome(tx.store(DocumentTransformsStore).findTransform(v)))
            throw new StudyError(
              'unsupported',
              'Session proposal retention requires captured context coordination'
            );

          return proposalCommitted(tx, tx.store(DocumentProposalsStore).keepProposal(v));
        }),
      proposeGenerated: (v: typeof e.publishSchema.Type) =>
        publicationTransaction((tx) => tx.store(DocumentProposalsStore).proposeGenerated(v)),
      updateMetadata: (v: typeof r.metadataSchema.Type) =>
        transaction((tx) => tx.store(DocumentsStore).updateMetadata(v)),
      ...versions,
      ...exports,
      exportFile: (v: typeof exportDocumentInputSchema.Type) =>
        transaction((tx) =>
          serializeDocumentVersion(tx.store(DocumentVersionsStore).version({ id: v.id }), v.format)
        ),
      ...history,
      ...deletion,
      ...annotations,
      ...annotationHistory,
      compare: comparisons.comparison,
      createAnnotation: (v: typeof evidence.createAnnotationSchema.Type) =>
        transaction((tx) =>
          annotationChanged(tx, tx.store(DocumentAnnotationsStore).createAnnotation(v))
        ),
      reviseAnnotation: (v: typeof evidence.reviseAnnotationSchema.Type) =>
        transaction((tx) =>
          annotationChanged(tx, tx.store(DocumentAnnotationsStore).reviseAnnotation(v))
        ),
      create: (v: typeof e.createSchema.Type) =>
        transaction((tx) => created(tx, tx.store(DocumentsStore).create(v))),
      save: (v: typeof e.saveSchema.Type) =>
        transaction((tx) => edited(tx, tx.store(DocumentsStore).save(v))),
      restore: (v: typeof e.restoreSchema.Type) =>
        transaction((tx) => edited(tx, tx.store(DocumentsStore).restore(v))),
      copySource: (v: typeof r.sourceCopySchema.Type) =>
        transaction((tx) => {
          Sources.extractionInTransaction(tx, v);

          return created(tx, tx.store(DocumentsStore).copySource(v));
        }),
      archive: (v: typeof r.archiveSchema.Type) =>
        transaction((tx) => tx.store(DocumentsStore).archive(v)),
      attachProject: (v: typeof r.projectLinkSchema.Type) =>
        transaction((tx) => tx.store(DocumentsStore).attachProject(v)),
      detachProject: (v: typeof r.projectLinkSchema.Type) =>
        transaction((tx) => tx.store(DocumentsStore).detachProject(v)),
      attach: (v: typeof r.linkSchema.Type) =>
        transaction((tx) => tx.store(DocumentsStore).attach(v)),
      detach: (v: typeof r.linkSchema.Type) =>
        transaction((tx) => tx.store(DocumentsStore).detach(v)),
      retireHistory: (v: typeof r.retireSchema.Type) =>
        transaction((tx) => {
          const preview = tx.store(DocumentHistoryStore).previewHistory(v);

          retireBodyWorkflows(tx, preview.versionIds);

          return tx.store(DocumentsStore).retireHistory(v);
        }),
      delete: (v: typeof r.deleteSchema.Type) =>
        transaction((tx) => {
          const preview = tx.store(DocumentDeletionStore).previewDeletion({ id: v.documentId });

          retireBodyWorkflows(tx, preview.versionIds);

          return tx.store(DocumentsStore).delete(v);
        }),
      createGenerated: (v: typeof e.createGeneratedSchema.Type) =>
        publicationTransaction((tx) => tx.store(DocumentsStore).createGenerated(v)),
      publishGenerated: (v: typeof e.publishSchema.Type) =>
        publicationTransaction((tx) => tx.store(DocumentsStore).publishGenerated(v))
    };
  }),
  {
    prepareSessionRetirement: (
      tx: Transaction,
      v: { sessionId: SessionId; contextIds: readonly string[] }
    ) => tx.store(DocumentTransformsStore).retireSessionRequests(v),
    validateBackup: (tx: Transaction) => tx.store(DocumentBackupStore).backupDocument(undefined),
    prepareBackup: (tx: Transaction) => tx.store(DocumentBackupStore).prepareBackup(undefined),
    findProposalReceiptInTransaction: (
      tx: Transaction,
      v:
        | (typeof e.applyProposalSchema.Type & { operation: 'apply' })
        | (typeof e.keepProposalSchema.Type & { operation: 'keep' })
    ) => Option.getOrNull(tx.store(DocumentProposalReceiptsStore).findProposalReceipt(v)),
    applyProposalInTransaction: (
      tx: Transaction,
      v: typeof e.applyProposalSchema.Type,
      relevantValid: boolean
    ) =>
      proposalCommitted(
        tx,
        tx.store(DocumentProposalsStore).applyProposal({ ...v, relevantValid })
      ),
    keepProposalInTransaction: (tx: Transaction, v: typeof e.keepProposalSchema.Type) =>
      proposalCommitted(tx, tx.store(DocumentProposalsStore).keepProposal(v)),
    findTransformInTransaction: (tx: Transaction, v: typeof t.transformKeySchema.Type) =>
      Option.getOrNull(tx.store(DocumentTransformsStore).findTransform(v)),
    requestTransformInTransaction: requestTransform,
    publishTransformInTransaction: publishTransform,
    retryTransformInTransaction: retryTransform,
    transformInTransaction: (tx: Transaction, v: typeof t.transformKeySchema.Type) =>
      tx.store(DocumentTransformsStore).transform(v),
    transformsInTransaction: (
      tx: Transaction,
      v: { sessionId: SessionId; limit: number; before?: string }
    ) => tx.store(DocumentTransformsStore).transforms(v),
    /** Conversations/AI can join publication to an existing fenced transaction. */
    proposeGeneratedInTransaction: (tx: Transaction, v: typeof e.publishSchema.Type) =>
      tx.store(DocumentProposalsStore).proposeGenerated(v),
    createGeneratedInTransaction: (tx: Transaction, v: typeof e.createGeneratedSchema.Type) =>
      tx.store(DocumentsStore).createGenerated(v),
    publishInTransaction: (tx: Transaction, v: typeof e.publishSchema.Type) =>
      tx.store(DocumentsStore).publishGenerated(v),
    createInTransaction: (tx: Transaction, v: typeof e.createSchema.Type) =>
      created(tx, tx.store(DocumentsStore).create(v)),
    documentInTransaction: (tx: Transaction, v: typeof r.documentKeySchema.Type) =>
      tx.store(DocumentsStore).document(v),
    versionInTransaction: (tx: Transaction, id: (typeof r.versionKeySchema.Type)['id']) =>
      tx.store(DocumentVersionsStore).version({ id }),
    attachInTransaction: (tx: Transaction, v: typeof r.linkSchema.Type) =>
      tx.store(DocumentsStore).attach(v)
  }
);

/** Canonical retirement and private native retirement share one rollback boundary. */
function retireBodyWorkflows(tx: Transaction, ids: readonly StudyDocumentVersionId[]) {
  const { ids: correlations } = tx
    .store(DocumentBodyRetirementStore)
    .bodyRetirementCorrelation(ids);

  Workflows.retireCorrelations(tx, correlations, [
    'DocumentGenerationRequested',
    'DocumentGenerationFailed'
  ]);
  Workflows.scrubRetiredCorrelations(tx, correlations);
}
