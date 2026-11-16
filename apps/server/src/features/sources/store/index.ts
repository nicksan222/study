/** @file Composes sources persistence with canonical typed store declarations. */

import { defineStore } from '#server/platform/definitions/define-store';

import { makeHistoricalDocumentStore, makeSourceDocumentStore } from './documents.ts';
import { makeSourceExportStore } from './exports.ts';
import { makeSourceFailureNoticeStore, makeSourceProcessingStore } from './processing.ts';
import { makeSourceSnapshotStore } from './snapshots.ts';
import { makeSourceStore } from './sources.ts';

export const HistoricalDocumentStore = defineStore({
  name: 'study/SourceHistoricalDocumentStore',
  entity: { singular: 'document', plural: 'documents' },
  make: (resources) => makeHistoricalDocumentStore(resources)
});

export const SourceDocumentStore = defineStore({
  name: 'study/SourceDocumentStore',
  entity: { singular: 'sourceDocument', plural: 'sourceDocuments' },
  make: (resources) => makeSourceDocumentStore(resources)
});

export const SourceExportStore = defineStore({
  name: 'study/SourceExportStore',
  entity: { singular: 'sourceExport', plural: 'sourceExports' },
  make: (resources) => makeSourceExportStore(resources)
});

export const SourceFailureNoticeStore = defineStore({
  name: 'study/SourceFailureNoticeStore',
  entity: { singular: 'sourceFailureNotice', plural: 'sourceFailureNotices' },
  make: (resources) => makeSourceFailureNoticeStore(resources)
});

export const SourceProcessingStore = defineStore({
  name: 'study/SourceProcessingStore',
  entity: { singular: 'sourceProcessing', plural: 'sourceProcessings' },
  make: (resources) => makeSourceProcessingStore(resources)
});

export const SourceSnapshotStore = defineStore({
  name: 'study/SourceSnapshotStore',
  entity: { singular: 'sourceSnapshot', plural: 'sourceSnapshots' },
  make: (resources) => makeSourceSnapshotStore(resources)
});

export const SourceStore = defineStore({
  name: 'study/SourceStore',
  entity: { singular: 'source', plural: 'sources' },
  make: (resources) => makeSourceStore(resources)
});
