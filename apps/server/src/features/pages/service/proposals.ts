/** @file Owns proposals within this feature. */

import type * as e from '@study/contracts';
import { StudyError } from '@study/contracts';
import type { Transaction } from '@study/server';
import { publicationTransaction, transaction, useStore } from '@study/server';
import { Option } from 'effect';

import { PageComparisonsStore, PageProposalsStore } from '#server/features/pages/store/index';
import { PageTransformsStore } from '#server/features/pages/store/transforms';

import { proposalCommitted } from './publication.ts';

export function* pageProposalOperations() {
  const proposals = yield* useStore(PageProposalsStore);

  return {
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
        assertProposalAuthority(tx, v, 'apply');

        return proposalCommitted(tx, tx.store(PageProposalsStore).applyProposal(v));
      }),
    keepProposal: (v: typeof e.keepProposalSchema.Type) =>
      transaction((tx) => {
        assertProposalAuthority(tx, v, 'keep');

        return proposalCommitted(tx, tx.store(PageProposalsStore).keepProposal(v));
      }),
    proposeGenerated: (v: typeof e.publishSchema.Type) =>
      publicationTransaction((tx) => tx.store(PageProposalsStore).proposeGenerated(v))
  };
}

function assertProposalAuthority(
  tx: Transaction,
  value: typeof e.proposalKeySchema.Type,
  operation: 'apply' | 'keep'
) {
  const request = Option.getOrNull(tx.store(PageTransformsStore).findTransform(value));

  if (request?.cancelled) throw new StudyError('cancelled', 'Proposal generation is unavailable');

  if (request && (!request.improvement || operation === 'keep'))
    throw new StudyError('unsupported', 'Proposal requires captured context coordination');
}
