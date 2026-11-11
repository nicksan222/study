/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates independent authored Page operations through transactional stores.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Coordinates independent authored Page operations through transactional stores.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy coordinates public services and private stores within caller-owned        │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { ProjectId } from '@study/contracts/ids';
import type { NoteId } from '@study/contracts/ids';
import type { PageVersionId } from '@study/contracts/ids';
import type * as e from '@study/contracts/pages/editing';
import type * as evidence from '@study/contracts/pages/evidence';
import type { exportPageInputSchema } from '@study/contracts/pages/export';
/** Pages alone owns authored publication. Workflow callers supply their Activity fence. */
import type * as r from '@study/contracts/pages/rpc';
import type * as t from '@study/contracts/pages/transform';
import type { Page } from '@study/contracts/pages/types';
import type { SearchProjectionPageInput } from '@study/contracts/search/schemas';
import { Effect, Option } from 'effect';

import {
  PageAnnotationsStore,
  PageAnnotationHistoryStore
} from '#server/features/pages/store/annotations';
import { PageBackupStore } from '#server/features/pages/store/backup';
import { PageBodyRetirementStore } from '#server/features/pages/store/body-retirement';
import {
  PagesStore,
  PageProposalsStore,
  PageProposalReceiptsStore,
  PageVersionsStore,
  PageComparisonsStore,
  PageExportsStore,
  PageHistoryStore,
  PageDeletionStore
} from '#server/features/pages/store/index';
import { PageMergesStore } from '#server/features/pages/store/merges';
import { PageSearchStore } from '#server/features/pages/store/search';
import { PageTransformsStore } from '#server/features/pages/store/transforms';
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
import { serializePageVersion } from './export-serializer.ts';
import { requestMerge, mergeContext } from './merge.ts';
import { requestTransform, publishTransform, retryTransform } from './transforms.ts';

function pagePublished(tx: Transaction, versionId: PageVersionId) {
  const eventId = crypto.randomUUID();

  tx.emit({
    type: 'PagePublished',
    eventId,
    causationId: null,
    correlationId: eventId,
    inputVersion: 1,
    depth: 0,
    versionId
  });
}

function created(tx: Transaction, result: { page: Page; replayed: boolean }) {
  if (!result.replayed && result.page.version) pagePublished(tx, result.page.version.id);

  return result.page;
}

function edited(tx: Transaction, result: typeof e.editOutcomeSchema.Type) {
  if (!result.replayed && result.outcome === 'saved') pagePublished(tx, result.submittedVersionId);

  return result;
}

function proposalCommitted(tx: Transaction, result: typeof e.proposalOutcomeSchema.Type) {
  if (!result.replayed && result.resultVersionId !== null)
    pagePublished(tx, result.resultVersionId);

  return result;
}

function annotationChanged(tx: Transaction, result: typeof evidence.annotationOutcomeSchema.Type) {
  if (result.outcome === 'saved') {
    const eventId = crypto.randomUUID();

    tx.emit({
      type: 'PageAnnotationChanged',
      eventId,
      causationId: null,
      correlationId: eventId,
      inputVersion: 1,
      depth: 0,
      pageId: result.annotation.target.pageId,
      annotationId: result.annotation.id,
      revision: result.annotation.revision
    });
  }

  return result;
}

export const Pages = defineService(
  'study/Pages',
  function* () {
    const docs = yield* useStore(PagesStore);
    const transforms = yield* useStore(PageTransformsStore);
    const merges = yield* useStore(PageMergesStore);
    const proposals = yield* useStore(PageProposalsStore);
    const annotations = yield* useStore(PageAnnotationsStore);
    const annotationHistory = yield* useStore(PageAnnotationHistoryStore);
    const versions = yield* useStore(PageVersionsStore);
    const comparisons = yield* useStore(PageComparisonsStore);
    const exports = yield* useStore(PageExportsStore);
    const history = yield* useStore(PageHistoryStore);
    const deletion = yield* useStore(PageDeletionStore);

    return {
      ...docs,
      assessCitation: (v: typeof evidence.assessCitationSchema.Type) =>
        transaction((tx) => assessCitation(tx, v)),
      assessments: (v: typeof evidence.assessmentsInputSchema.Type) =>
        transaction((tx) => citationAssessments(tx, v)),
      merges: Effect.fnUntraced(function* (v: { projectId?: ProjectId }) {
        const pending: (typeof t.transformSnapshotSchema.Type)[] = [];
        let page;

        do {
          page = yield* merges.merges({
            ...v,
            pending: true,
            offset: pending.length,
            limit: 1000
          });
          pending.push(...page);
        } while (page.length === 1000);

        const completed = yield* merges.merges({ ...v, pending: false, offset: 0, limit: 3 });

        return [...pending, ...completed];
      }),
      merge: (v: typeof t.mergeRequestSchema.Type) => transaction((tx) => requestMerge(tx, v)),
      mergeContext: (v: typeof t.transformKeySchema.Type) =>
        transaction((tx) => mergeContext(tx, v)),
      publishMerge: (v: typeof t.transformPublicationSchema.Type) =>
        publicationTransaction((tx) => {
          const request = tx.store(PageTransformsStore).transform(v);

          if (!request.merge) throw new StudyError('invalid_input', 'Not a page merge');

          return publishTransform(
            tx,
            request.resultVersionId === null ? mergeContext(tx, v) : undefined,
            v
          );
        }),
      retryMerge: (v: { requestId: string; retryId: string }) =>
        transaction((tx) => {
          const request = tx.store(PageTransformsStore).transform(v);

          if (!request.merge) throw new StudyError('invalid_input', 'Not a page merge');

          return retryTransform(tx, v);
        }),
      transform: transforms.transform,
      cancelTransform: Effect.fnUntraced(function* (v: typeof t.transformKeySchema.Type) {
        const request = yield* transaction((tx) =>
          tx.store(PageTransformsStore).changeTransform({ ...v, cancel: true, errorKind: null })
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
          const old = tx.store(PageTransformsStore).transform(v);

          if (old.eventId !== v.eventId || old.cancelled || old.resultVersionId !== null) return;

          tx.store(PageTransformsStore).changeTransform({ ...v, cancel: false });
          tx.emit({
            type: 'PageGenerationFailed',
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
          const p = tx.store(PageProposalsStore).proposal(v);

          return tx.store(PageComparisonsStore).comparison({
            beforeVersionId: p.baseVersionId,
            proposedVersionId: p.proposedVersionId,
            currentVersionId: p.currentVersionId
          });
        }),
      applyProposal: (v: typeof e.applyProposalSchema.Type) =>
        transaction((tx) => {
          if (Option.isSome(tx.store(PageTransformsStore).findTransform(v)))
            throw new StudyError(
              'unsupported',
              'Note proposal application requires captured context coordination'
            );

          return proposalCommitted(tx, tx.store(PageProposalsStore).applyProposal(v));
        }),
      keepProposal: (v: typeof e.keepProposalSchema.Type) =>
        transaction((tx) => {
          if (Option.isSome(tx.store(PageTransformsStore).findTransform(v)))
            throw new StudyError(
              'unsupported',
              'Note proposal retention requires captured context coordination'
            );

          return proposalCommitted(tx, tx.store(PageProposalsStore).keepProposal(v));
        }),
      proposeGenerated: (v: typeof e.publishSchema.Type) =>
        publicationTransaction((tx) => tx.store(PageProposalsStore).proposeGenerated(v)),
      updateMetadata: (v: typeof r.metadataSchema.Type) =>
        transaction((tx) => tx.store(PagesStore).updateMetadata(v)),
      ...versions,
      ...exports,
      exportFile: (v: typeof exportPageInputSchema.Type) =>
        transaction((tx) =>
          serializePageVersion(tx.store(PageVersionsStore).version({ id: v.id }), v.format)
        ),
      ...history,
      ...deletion,
      ...annotations,
      ...annotationHistory,
      compare: comparisons.comparison,
      createAnnotation: (v: typeof evidence.createAnnotationSchema.Type) =>
        transaction((tx) =>
          annotationChanged(tx, tx.store(PageAnnotationsStore).createAnnotation(v))
        ),
      reviseAnnotation: (v: typeof evidence.reviseAnnotationSchema.Type) =>
        transaction((tx) =>
          annotationChanged(tx, tx.store(PageAnnotationsStore).reviseAnnotation(v))
        ),
      create: (v: typeof e.createSchema.Type) =>
        transaction((tx) => created(tx, tx.store(PagesStore).create(v))),
      saveInNote: (noteId: NoteId, v: typeof e.saveSchema.Type) =>
        transaction((tx) => {
          tx.store(PagesStore).page({ noteId, id: v.pageId });

          return edited(tx, tx.store(PagesStore).save(v));
        }),
      save: (v: typeof e.saveSchema.Type) =>
        transaction((tx) => edited(tx, tx.store(PagesStore).save(v))),
      restore: (v: typeof e.restoreSchema.Type) =>
        transaction((tx) => edited(tx, tx.store(PagesStore).restore(v))),
      copySource: (v: typeof r.sourceCopySchema.Type) =>
        transaction((tx) => {
          Sources.extractionInTransaction(tx, v);

          return created(tx, tx.store(PagesStore).copySource(v));
        }),
      archive: (v: typeof r.archiveSchema.Type) =>
        transaction((tx) => tx.store(PagesStore).archive(v)),
      attachProject: (v: typeof r.projectLinkSchema.Type) =>
        transaction((tx) => tx.store(PagesStore).attachProject(v)),
      detachProject: (v: typeof r.projectLinkSchema.Type) =>
        transaction((tx) => tx.store(PagesStore).detachProject(v)),
      attach: (v: typeof r.linkSchema.Type) => transaction((tx) => tx.store(PagesStore).attach(v)),
      detach: (v: typeof r.linkSchema.Type) => transaction((tx) => tx.store(PagesStore).detach(v)),
      retireHistory: (v: typeof r.retireSchema.Type) =>
        transaction((tx) => {
          const preview = tx.store(PageHistoryStore).previewHistory(v);

          retireBodyWorkflows(tx, preview.versionIds);

          return tx.store(PagesStore).retireHistory(v);
        }),
      delete: (v: typeof r.deleteSchema.Type) =>
        transaction((tx) => {
          const preview = tx.store(PageDeletionStore).previewDeletion({ id: v.pageId });

          retireBodyWorkflows(tx, preview.versionIds);

          return tx.store(PagesStore).delete(v);
        }),
      createGenerated: (v: typeof e.createGeneratedSchema.Type) =>
        publicationTransaction((tx) => tx.store(PagesStore).createGenerated(v)),
      publishGenerated: (v: typeof e.publishSchema.Type) =>
        publicationTransaction((tx) => tx.store(PagesStore).publishGenerated(v))
    };
  },
  {
    searchProjectionsInTransaction: (tx: Transaction, input: SearchProjectionPageInput) =>
      tx.store(PageSearchStore).searchProjectionPages(input),
    prepareNoteRetirement: (
      tx: Transaction,
      v: { noteId: NoteId; contextIds: readonly string[] }
    ) => tx.store(PageTransformsStore).retireNoteRequests(v),
    validateBackup: (tx: Transaction) => tx.store(PageBackupStore).backupPage(undefined),
    prepareBackup: (tx: Transaction) => tx.store(PageBackupStore).prepareBackup(undefined),
    findProposalReceiptInTransaction: (
      tx: Transaction,
      v:
        | (typeof e.applyProposalSchema.Type & { operation: 'apply' })
        | (typeof e.keepProposalSchema.Type & { operation: 'keep' })
    ) => Option.getOrNull(tx.store(PageProposalReceiptsStore).findProposalReceipt(v)),
    applyProposalInTransaction: (
      tx: Transaction,
      v: typeof e.applyProposalSchema.Type,
      relevantValid: boolean
    ) => proposalCommitted(tx, tx.store(PageProposalsStore).applyProposal({ ...v, relevantValid })),
    keepProposalInTransaction: (tx: Transaction, v: typeof e.keepProposalSchema.Type) =>
      proposalCommitted(tx, tx.store(PageProposalsStore).keepProposal(v)),
    findTransformInTransaction: (tx: Transaction, v: typeof t.transformKeySchema.Type) =>
      Option.getOrNull(tx.store(PageTransformsStore).findTransform(v)),
    requestTransformInTransaction: requestTransform,
    publishTransformInTransaction: publishTransform,
    retryTransformInTransaction: retryTransform,
    transformInTransaction: (tx: Transaction, v: typeof t.transformKeySchema.Type) =>
      tx.store(PageTransformsStore).transform(v),
    transformsInTransaction: (
      tx: Transaction,
      v: { noteId: NoteId; limit: number; before?: string }
    ) => tx.store(PageTransformsStore).transforms(v),
    /** Notes/AI can join publication to an existing fenced transaction. */
    proposeGeneratedInTransaction: (tx: Transaction, v: typeof e.publishSchema.Type) =>
      tx.store(PageProposalsStore).proposeGenerated(v),
    createGeneratedInTransaction: (tx: Transaction, v: typeof e.createGeneratedSchema.Type) =>
      tx.store(PagesStore).createGenerated(v),
    publishInTransaction: (tx: Transaction, v: typeof e.publishSchema.Type) =>
      tx.store(PagesStore).publishGenerated(v),
    createInTransaction: (tx: Transaction, v: typeof e.createSchema.Type) =>
      created(tx, tx.store(PagesStore).create(v)),
    pageInTransaction: (tx: Transaction, v: typeof r.pageKeySchema.Type) =>
      tx.store(PagesStore).page(v),
    versionInTransaction: (tx: Transaction, id: (typeof r.versionKeySchema.Type)['id']) =>
      tx.store(PageVersionsStore).version({ id }),
    archiveNoteInTransaction: (
      tx: Transaction,
      v: typeof r.linkSchema.Type & { archivedAt: bigint | null }
    ) => tx.store(PagesStore).archiveNote(v),
    attachInTransaction: (tx: Transaction, v: typeof r.linkSchema.Type) =>
      tx.store(PagesStore).attach(v)
  }
);

/** Canonical retirement and private native retirement share one rollback boundary. */
function retireBodyWorkflows(tx: Transaction, ids: readonly PageVersionId[]) {
  const { ids: correlations } = tx.store(PageBodyRetirementStore).bodyRetirementCorrelation(ids);

  Workflows.retireCorrelations(tx, correlations, [
    'PageGenerationRequested',
    'PageGenerationFailed'
  ]);
  Workflows.scrubRetiredCorrelations(tx, correlations);
}
