/** @file Builds pages proposals queries and mutations with bound store resources. */

import * as e from '@study/contracts';
import { Option, Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { storeMutation, storeQuery } from '#server/platform/definitions/define-store';

import { makePageDomain } from './domain.ts';

export function makePageProposalsStore(resources: StoreResources) {
  const d = makePageDomain(resources);

  return {
    queries: {
      proposal: storeQuery({
        role: 'required',
        input: e.proposalKeySchema,
        output: e.proposalSchema,
        run: d.proposal
      })
    },
    mutations: {
      proposeGenerated: storeMutation({
        changes: ['pages'],
        input: e.publishSchema,
        output: e.proposalSchema,
        run: d.proposeGenerated
      }),
      applyProposal: storeMutation({
        changes: ['pages'],
        input: Schema.Struct({
          ...e.applyProposalSchema.fields,
          relevantValid: Schema.optional(Schema.Boolean)
        }),
        output: e.proposalOutcomeSchema,
        run: d.applyProposal
      }),
      keepProposal: storeMutation({
        changes: ['pages'],
        input: e.keepProposalSchema,
        output: e.proposalOutcomeSchema,
        run: d.keepProposal
      })
    }
  };
}

export function makePageProposalReceiptsStore(resources: StoreResources) {
  const d = makePageDomain(resources);

  return {
    queries: {
      findProposalReceipt: storeQuery({
        role: 'optional',
        input: Schema.Union([
          Schema.Struct({ ...e.applyProposalSchema.fields, operation: Schema.Literal('apply') }),
          Schema.Struct({ ...e.keepProposalSchema.fields, operation: Schema.Literal('keep') })
        ]),
        output: Schema.Option(e.proposalOutcomeSchema),
        run: (v) => Option.fromNullishOr(d.findProposalReceipt(v))
      })
    },
    mutations: {}
  };
}
