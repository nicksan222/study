/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Binds authored Document query and mutation descriptors to private persistence.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Binds authored Document query and mutation descriptors to private persistence.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Documents ownership; callers own            │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import * as e from '@study/contracts/documents/editing';
import * as r from '@study/contracts/documents/rpc';
import * as c from '@study/contracts/documents/schemas';
import { Schema, Option } from 'effect';

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';

import { makeDocumentDomain } from './domain.ts';

export const DocumentsStore = defineStore({
  name: 'study/DocumentsStore',
  entity: { singular: 'document', plural: 'documents' },
  make: (resources) => {
    const d = makeDocumentDomain(resources);

    return {
      queries: {
        document: storeQuery({
          role: 'required',
          input: r.documentKeySchema,
          output: c.detailSchema,
          run: ({ id }) => d.document(id)
        }),
        documents: storeQuery({
          role: 'collection',
          input: r.listSchema,
          output: c.documentPageSchema,
          run: d.documents
        })
      },
      mutations: {
        updateMetadata: storeMutation({
          input: r.metadataSchema,
          output: c.detailSchema,
          run: d.updateMetadata
        }),
        create: storeMutation({
          input: e.createSchema,
          output: Schema.Struct({ document: c.detailSchema, replayed: Schema.Boolean }),
          run: d.createResult
        }),
        save: storeMutation({ input: e.saveSchema, output: e.editOutcomeSchema, run: d.save }),
        restore: storeMutation({
          input: e.restoreSchema,
          output: e.editOutcomeSchema,
          run: d.restore
        }),
        copySource: storeMutation({
          input: r.sourceCopySchema,
          output: Schema.Struct({ document: c.detailSchema, replayed: Schema.Boolean }),
          run: d.copySource
        }),
        archive: storeMutation({ input: r.archiveSchema, output: c.detailSchema, run: d.archive }),
        attachProject: storeMutation({
          input: r.projectLinkSchema,
          output: Schema.Void,
          run: d.attachProject
        }),
        detachProject: storeMutation({
          input: r.projectLinkSchema,
          output: Schema.Void,
          run: d.detachProject
        }),
        attach: storeMutation({ input: r.linkSchema, output: Schema.Void, run: d.attach }),
        detach: storeMutation({ input: r.linkSchema, output: Schema.Void, run: d.detach }),
        retireHistory: storeMutation({
          input: r.retireSchema,
          output: r.retirementPreviewSchema,
          run: (v) => d.retire(v.documentId, v.keepLatest, v.token, false, v.versionId)
        }),
        delete: storeMutation({
          input: r.deleteSchema,
          output: Schema.Void,
          run: (v) => {
            d.retire(v.documentId, 0, v.token, true);
          }
        }),
        createGenerated: storeMutation({
          input: e.createGeneratedSchema,
          output: e.createGeneratedOutcomeSchema,
          run: d.createGenerated
        }),
        publishGenerated: storeMutation({
          input: e.publishSchema,
          output: e.editOutcomeSchema,
          run: d.publishGenerated
        })
      }
    };
  }
});

export const DocumentVersionsStore = defineStore({
  name: 'study/DocumentVersionsStore',
  entity: { singular: 'version', plural: 'versions' },
  make: (resources) => {
    const d = makeDocumentDomain(resources);

    return {
      queries: {
        version: storeQuery({
          role: 'required',
          input: r.versionKeySchema,
          output: c.versionSchema,
          run: ({ id }) => d.version(id)
        }),
        versions: storeQuery({
          role: 'collection',
          input: r.versionsSchema,
          output: c.versionPageSchema,
          run: d.versions
        })
      },
      mutations: {}
    };
  }
});

export const DocumentComparisonsStore = defineStore({
  name: 'study/DocumentComparisonsStore',
  entity: { singular: 'comparison', plural: 'comparisons' },
  make: (resources) => ({
    queries: {
      comparison: storeQuery({
        role: 'required',
        input: e.compareSchema,
        output: e.comparisonSchema,
        run: makeDocumentDomain(resources).compare
      })
    },
    mutations: {}
  })
});

export const DocumentExportsStore = defineStore({
  name: 'study/DocumentExportsStore',
  entity: { singular: 'exportVersion', plural: 'exportVersions' },
  make: (resources) => ({
    queries: {
      exportVersion: storeQuery({
        role: 'required',
        input: r.versionKeySchema,
        output: r.exportSchema,
        run: makeDocumentDomain(resources).exportVersion
      })
    },
    mutations: {}
  })
});

export const DocumentHistoryStore = defineStore({
  name: 'study/DocumentHistoryStore',
  entity: { singular: 'previewHistory', plural: 'historyPreviews' },
  make: (resources) => ({
    queries: {
      previewHistory: storeQuery({
        role: 'required',
        input: r.historySchema,
        output: r.retirementPreviewSchema,
        run: (v) =>
          makeDocumentDomain(resources).preview(v.documentId, v.keepLatest, false, v.versionId)
      })
    },
    mutations: {}
  })
});

export const DocumentDeletionStore = defineStore({
  name: 'study/DocumentDeletionStore',
  entity: { singular: 'previewDeletion', plural: 'deletionPreviews' },
  make: (resources) => ({
    queries: {
      previewDeletion: storeQuery({
        role: 'required',
        input: r.documentKeySchema,
        output: r.retirementPreviewSchema,
        run: (v) => makeDocumentDomain(resources).preview(v.id, 0, true)
      })
    },
    mutations: {}
  })
});

export const DocumentProposalsStore = defineStore({
  name: 'study/DocumentProposalsStore',
  entity: { singular: 'proposal', plural: 'proposals' },
  make: (resources) => {
    const d = makeDocumentDomain(resources);

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
          input: e.publishSchema,
          output: e.proposalSchema,
          run: d.proposeGenerated
        }),
        applyProposal: storeMutation({
          input: Schema.Struct({
            ...e.applyProposalSchema.fields,
            relevantValid: Schema.optional(Schema.Boolean)
          }),
          output: e.proposalOutcomeSchema,
          run: d.applyProposal
        }),
        keepProposal: storeMutation({
          input: e.keepProposalSchema,
          output: e.proposalOutcomeSchema,
          run: d.keepProposal
        })
      }
    };
  }
});

export const DocumentProposalReceiptsStore = defineStore({
  name: 'study/DocumentProposalReceiptsStore',
  entity: { singular: 'proposalReceipt', plural: 'proposalReceipts' },
  make: (resources) => {
    const d = makeDocumentDomain(resources);

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
});
