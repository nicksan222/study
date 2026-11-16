/** @file Composes pages application operations behind the feature boundary. */

import type * as e from '@study/contracts';
import type * as r from '@study/contracts';
import type * as t from '@study/contracts';
import type { NoteId } from '@study/contracts';
import { defineService } from '@study/server';
import type { Transaction } from '@study/server';
import { Option } from 'effect';

import { PageBackupStore } from '#server/features/pages/store/backup';
import {
  PageProposalReceiptsStore,
  PageProposalsStore,
  PageVersionsStore,
  PagesStore
} from '#server/features/pages/store/index';
import { PageTransformsStore } from '#server/features/pages/store/transforms';

import { pageEditingOperations } from './editing.ts';
import { pageEvidenceOperations } from './evidence.ts';
import { pageGenerationOperations } from './generation.ts';
import { pageLibraryOperations } from './library.ts';
import { pageProposalOperations } from './proposals.ts';
import { created, proposalCommitted } from './publication.ts';
import { pageRetirementOperations } from './retirement.ts';
import { pageTransformOperations } from './transform-operations.ts';
import { publishTransform, requestTransform, retryTransform } from './transforms.ts';

export const Pages = defineService(
  'study/Pages',
  function* () {
    return {
      ...(yield* pageLibraryOperations()),
      ...(yield* pageEvidenceOperations()),
      ...pageEditingOperations(),
      ...(yield* pageProposalOperations()),
      ...(yield* pageTransformOperations()),
      ...pageGenerationOperations(),
      ...pageRetirementOperations()
    };
  },
  {
    prepareNoteRetirement: (
      tx: Transaction,
      v: { noteId: NoteId; contextIds: readonly string[] }
    ) => tx.store(PageTransformsStore).retireNoteRequests(v),
    validateBackup: (tx: Transaction) => tx.store(PageBackupStore).backupPage(undefined),
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
