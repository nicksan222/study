/** @file Composes pages persistence with canonical typed store declarations. */

import { defineStore } from '#server/platform/definitions/define-store';

import { makePageComparisonsStore } from './comparisons.ts';
import { makePageDeletionStore } from './deletion.ts';
import { makePageExportsStore } from './exports.ts';
import { makePageHistoryStore } from './history.ts';
import { makePagesStore } from './pages.ts';
import { makePageProposalReceiptsStore, makePageProposalsStore } from './proposals.ts';
import { makePageVersionsStore } from './versions.ts';

export const PageComparisonsStore = defineStore({
  name: 'study/PageComparisonsStore',
  entity: { singular: 'comparison', plural: 'comparisons' },
  make: (resources) => makePageComparisonsStore(resources)
});

export const PageDeletionStore = defineStore({
  name: 'study/PageDeletionStore',
  entity: { singular: 'previewDeletion', plural: 'deletionPreviews' },
  make: (resources) => makePageDeletionStore(resources)
});

export const PageExportsStore = defineStore({
  name: 'study/PageExportsStore',
  entity: { singular: 'exportVersion', plural: 'exportVersions' },
  make: (resources) => makePageExportsStore(resources)
});

export const PageHistoryStore = defineStore({
  name: 'study/PageHistoryStore',
  entity: { singular: 'previewHistory', plural: 'historyPreviews' },
  make: (resources) => makePageHistoryStore(resources)
});

export const PagesStore = defineStore({
  name: 'study/PagesStore',
  entity: { singular: 'page', plural: 'pages' },
  make: (resources) => makePagesStore(resources)
});

export const PageProposalReceiptsStore = defineStore({
  name: 'study/PageProposalReceiptsStore',
  entity: { singular: 'proposalReceipt', plural: 'proposalReceipts' },
  make: (resources) => makePageProposalReceiptsStore(resources)
});

export const PageProposalsStore = defineStore({
  name: 'study/PageProposalsStore',
  entity: { singular: 'proposal', plural: 'proposals' },
  make: (resources) => makePageProposalsStore(resources)
});

export const PageVersionsStore = defineStore({
  name: 'study/PageVersionsStore',
  entity: { singular: 'version', plural: 'versions' },
  make: (resources) => makePageVersionsStore(resources)
});
