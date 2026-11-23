/** @file Owns proposals within this feature. */

import type * as e from '@study/contracts';
import { StudyError } from '@study/contracts';
import { transaction, useStore } from '@study/server';
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
      })
  };
}
