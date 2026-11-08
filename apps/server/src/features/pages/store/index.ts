/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Binds authored Page query and mutation descriptors to private persistence.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Binds authored Page query and mutation descriptors to private persistence.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Pages ownership; callers own                │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import * as e from '@study/contracts/pages/editing';
import * as r from '@study/contracts/pages/rpc';
import * as c from '@study/contracts/pages/schemas';
import { and, eq, sql } from '@study/db';
import { note_pages } from '@study/db/schema';
import { Schema, Option } from 'effect';

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';

import { makePageDomain } from './domain.ts';

export const PagesStore = defineStore({
  name: 'study/PagesStore',
  entity: { singular: 'page', plural: 'pages' },
  make: (resources) => {
    const d = makePageDomain(resources);
    const { db } = resources;

    return {
      queries: {
        page: storeQuery({
          role: 'required',
          input: r.pageKeySchema,
          output: c.detailSchema,
          run: ({ id, noteId }) => {
            if (
              noteId !== undefined &&
              !db.orm
                .select({ id: note_pages.page_id })
                .from(note_pages)
                .where(
                  and(
                    eq(note_pages.page_id, id),
                    eq(note_pages.note_id, noteId),
                    sql`${note_pages.archived_at} IS NULL`
                  )
                )
                .get()
            )
              throw new StudyError('not_found', 'Page is not in this note');

            return d.page(id);
          }
        }),
        pages: storeQuery({
          role: 'collection',
          input: r.listSchema,
          output: c.pageListSchema,
          run: d.pages
        })
      },
      mutations: {
        archiveNote: storeMutation({
          input: Schema.Struct({
            ...r.linkSchema.fields,
            archivedAt: Schema.NullOr(Schema.BigInt)
          }),
          output: Schema.Void,
          run: (v) => {
            const changed = db.orm
              .update(note_pages)
              .set({ archived_at: v.archivedAt })
              .where(
                and(
                  eq(note_pages.page_id, v.pageId),
                  eq(note_pages.note_id, v.noteId),
                  sql`NOT EXISTS(SELECT 1 FROM page_deletions d WHERE d.page_id=${note_pages.page_id})`
                )
              )
              .returning({ id: note_pages.page_id })
              .get();

            if (!changed) throw new StudyError('not_found', 'Note item is unavailable');
          }
        }),
        updateMetadata: storeMutation({
          input: r.metadataSchema,
          output: c.detailSchema,
          run: d.updateMetadata
        }),
        create: storeMutation({
          input: e.createSchema,
          output: Schema.Struct({ page: c.detailSchema, replayed: Schema.Boolean }),
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
          output: Schema.Struct({ page: c.detailSchema, replayed: Schema.Boolean }),
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
          run: (v) => d.retire(v.pageId, v.keepLatest, v.token, false, v.versionId)
        }),
        delete: storeMutation({
          input: r.deleteSchema,
          output: Schema.Void,
          run: (v) => {
            d.retire(v.pageId, 0, v.token, true);
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

export const PageVersionsStore = defineStore({
  name: 'study/PageVersionsStore',
  entity: { singular: 'version', plural: 'versions' },
  make: (resources) => {
    const d = makePageDomain(resources);

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

export const PageComparisonsStore = defineStore({
  name: 'study/PageComparisonsStore',
  entity: { singular: 'comparison', plural: 'comparisons' },
  make: (resources) => ({
    queries: {
      comparison: storeQuery({
        role: 'required',
        input: e.compareSchema,
        output: e.comparisonSchema,
        run: makePageDomain(resources).compare
      })
    },
    mutations: {}
  })
});

export const PageExportsStore = defineStore({
  name: 'study/PageExportsStore',
  entity: { singular: 'exportVersion', plural: 'exportVersions' },
  make: (resources) => ({
    queries: {
      exportVersion: storeQuery({
        role: 'required',
        input: r.versionKeySchema,
        output: r.exportSchema,
        run: makePageDomain(resources).exportVersion
      })
    },
    mutations: {}
  })
});

export const PageHistoryStore = defineStore({
  name: 'study/PageHistoryStore',
  entity: { singular: 'previewHistory', plural: 'historyPreviews' },
  make: (resources) => ({
    queries: {
      previewHistory: storeQuery({
        role: 'required',
        input: r.historySchema,
        output: r.retirementPreviewSchema,
        run: (v) => makePageDomain(resources).preview(v.pageId, v.keepLatest, false, v.versionId)
      })
    },
    mutations: {}
  })
});

export const PageDeletionStore = defineStore({
  name: 'study/PageDeletionStore',
  entity: { singular: 'previewDeletion', plural: 'deletionPreviews' },
  make: (resources) => ({
    queries: {
      previewDeletion: storeQuery({
        role: 'required',
        input: r.pageKeySchema,
        output: r.retirementPreviewSchema,
        run: (v) => makePageDomain(resources).preview(v.id, 0, true)
      })
    },
    mutations: {}
  })
});

export const PageProposalsStore = defineStore({
  name: 'study/PageProposalsStore',
  entity: { singular: 'proposal', plural: 'proposals' },
  make: (resources) => {
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

export const PageProposalReceiptsStore = defineStore({
  name: 'study/PageProposalReceiptsStore',
  entity: { singular: 'proposalReceipt', plural: 'proposalReceipts' },
  make: (resources) => {
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
});
