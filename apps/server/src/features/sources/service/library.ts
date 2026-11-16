/** @file Owns library within this feature. */

import type {
  exactExtractionInputSchema,
  setSourceProjectInputSchema,
  sourceLinkSchema,
  sourcePageInputSchema
} from '@study/contracts';
import { Effect, Option } from 'effect';

import {
  CurrentExtractionStore,
  NoteSourcesStore,
  SourceExtractionsStore,
  SourceRevisionExportsStore
} from '#server/features/sources/store/exact-extraction';
import {
  HistoricalDocumentStore,
  SourceDocumentStore,
  SourceExportStore,
  SourceProcessingStore,
  SourceSnapshotStore,
  SourceStore
} from '#server/features/sources/store/index';
import { transaction, useStore } from '#server/platform/definitions/define-store';
import { pageById } from '#server/platform/definitions/page-by-id';

type SourcePageInput = typeof sourcePageInputSchema.Type;

export function* sourceLibraryOperations() {
  const sources = yield* useStore(SourceStore);

  const extractions = yield* useStore(SourceExtractionsStore);

  const revisions = yield* useStore(SourceRevisionExportsStore);

  const currentExtraction = yield* useStore(CurrentExtractionStore);

  const noteSources = yield* useStore(NoteSourcesStore);

  const exports = yield* useStore(SourceExportStore);

  const processing = yield* useStore(SourceProcessingStore);

  const snapshots = yield* useStore(SourceSnapshotStore);

  const documents = yield* useStore(SourceDocumentStore);

  const historical = yield* useStore(HistoricalDocumentStore);

  return {
    source: sources.source,
    sourceExport: exports.sourceExport,
    findSource: sources.findSource,
    sources: (input: SourcePageInput) => pageById(sources.sources, input),
    sourceProcessing: processing.sourceProcessing,
    extraction: (v: typeof exactExtractionInputSchema.Type) =>
      sources.source(v.sourceId).pipe(Effect.andThen(extractions.extraction(v))),
    currentExtraction: (v: Parameters<typeof currentExtraction.findCurrentExtraction>[0]) =>
      sources
        .source(v.id)
        .pipe(
          Effect.andThen(currentExtraction.findCurrentExtraction(v)),
          Effect.map(Option.getOrNull)
        ),
    extractions: (v: Parameters<typeof extractions.extractions>[0]) =>
      sources.source(v.sourceId).pipe(Effect.andThen(extractions.extractions(v))),
    exportRevision: (v: Parameters<typeof revisions.revisionExport>[0]) =>
      sources.source(v.sourceId).pipe(Effect.andThen(revisions.revisionExport(v))),
    noteSources: noteSources.noteSources,
    noteSourceExtraction: (v: typeof sourceLinkSchema.Type) =>
      transaction((tx) => {
        tx.store(NoteSourcesStore).noteSource(v);

        return Option.getOrNull(
          tx.store(CurrentExtractionStore).findCurrentExtraction({ id: v.sourceId })
        );
      }),
    attachSource: (v: typeof sourceLinkSchema.Type) =>
      transaction((tx) => {
        tx.store(SourceStore).source(v.sourceId);
        tx.store(NoteSourcesStore).attachSource(v);
      }),
    detachSource: (v: typeof sourceLinkSchema.Type) =>
      transaction((tx) => tx.store(NoteSourcesStore).detachSource(v)),
    sourceSnapshot: snapshots.sourceSnapshot,
    sourceDocument: documents.sourceDocument,
    document: historical.document,
    setSourceProject: (input: typeof setSourceProjectInputSchema.Type) =>
      transaction((tx) => {
        const store = tx.store(SourceStore);

        const before = store.source(input.id);

        const source = store.setSourceProject(input);

        const state = tx.store(SourceProcessingStore).sourceProcessing(input.id);

        if (before.projectId !== input.projectId) {
          const eventId = crypto.randomUUID();

          tx.emit({
            type: 'SourceProjectChanged',
            eventId,
            causationId: null,
            correlationId: eventId,
            inputVersion: state.revision,
            depth: 0,
            sourceId: input.id
          });
        }

        if (before.projectId !== input.projectId && state.documentId !== null) {
          const eventId = crypto.randomUUID();

          tx.emit({
            type: 'SourceIndexed',
            eventId,
            causationId: null,
            correlationId: eventId,
            inputVersion: state.revision,
            depth: 0,
            projectId: input.projectId,
            sourceId: input.id,
            documentId: state.documentId
          });
        }

        return source;
      })
  };
}
