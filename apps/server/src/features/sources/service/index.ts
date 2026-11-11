/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates source persistence, decoding, processing requests, corrections, and    │
 * │ publication transactions across source-owned stores.                                     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Feature services own application rules and coordinate typed store operations.          │
 * │ - Validates or coordinates feature-level operations.                                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses owned stores and platform transactions rather than querying SQLite directly.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import type { SourcePublicationRequested } from '@study/contracts/events';
import type { ProjectId, NoteId, SourceId } from '@study/contracts/ids';
import type {
  importCapabilityInputSchema,
  importCapabilitySchema
} from '@study/contracts/sources/capabilities';
import type { Document } from '@study/contracts/sources/document';
import type {
  sourceHistoryInputSchema,
  sourceHistoryRetireSchema,
  sourcePageInputSchema,
  sourceLinkSchema,
  exactExtractionInputSchema,
  correctBlockInputSchema,
  setSourceProjectInputSchema
} from '@study/contracts/sources/rpc';
import { sniff } from '@study/contracts/sources/sniff';
import { Effect, Option } from 'effect';

import { Settings } from '#server/features/settings/index';
import { decoderPath } from '#server/features/sources/decoders/capability';
import { decodeText } from '#server/features/sources/decoders/text';
import type {
  ConversionInput,
  ConversionContext
} from '#server/features/sources/service/conversion/registry';
import { conversions } from '#server/features/sources/service/conversion/strategies';
import { SourceBackupStore } from '#server/features/sources/store/backup';
import {
  SourceExtractionsStore,
  SourceRevisionExportsStore,
  CurrentExtractionStore,
  NoteSourcesStore
} from '#server/features/sources/store/exact-extraction';
import {
  SourceHistoryStore,
  SourceHistoryRetirementStore
} from '#server/features/sources/store/history';
import {
  SourceStore,
  SourceExportStore,
  SourceProcessingStore,
  SourceSnapshotStore,
  SourceDocumentStore,
  HistoricalDocumentStore,
  SourceFailureNoticeStore
} from '#server/features/sources/store/index';
import { RecordingImportStore } from '#server/features/sources/store/recording';
import {
  SourceRetirementStore,
  SourceDeletionPreviewStore
} from '#server/features/sources/store/retirement';
import { Workflows } from '#server/features/workflows/index';
import type { AuthManager } from '#server/platform/ai/auth/index';
import { ChatGptSession } from '#server/platform/ai/auth/service';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';
import {
  transaction,
  useStore,
  publicationTransaction
} from '#server/platform/definitions/define-store';
import { pageById } from '#server/platform/definitions/page-by-id';
import { validateLink } from '#server/platform/http/index';

type SourcePageInput = typeof sourcePageInputSchema.Type;

export const Sources = defineService(
  'study/Sources',
  function* () {
    const sources = yield* useStore(SourceStore);
    const histories = yield* useStore(SourceHistoryStore);
    const extractions = yield* useStore(SourceExtractionsStore);
    const revisions = yield* useStore(SourceRevisionExportsStore);
    const currentExtraction = yield* useStore(CurrentExtractionStore);
    const noteSources = yield* useStore(NoteSourcesStore);

    const exports = yield* useStore(SourceExportStore);

    const processing = yield* useStore(SourceProcessingStore);

    const snapshots = yield* useStore(SourceSnapshotStore);

    const documents = yield* useStore(SourceDocumentStore);

    const historical = yield* useStore(HistoricalDocumentStore);

    const requested = (
      tx: Transaction,
      sourceId: SourceId,
      revision: number,
      requestId: string,
      causationId: string | null = null
    ) => {
      tx.emit({
        type: 'SourceProcessingRequested',
        eventId: randomUUID(),
        causationId,
        correlationId: requestId,
        inputVersion: revision,
        depth: causationId === null ? 0 : 1,
        sourceId,
        requestId
      });
    };

    return {
      conversionStrategies: () =>
        Settings.use((settings) => settings.language()).pipe(
          Effect.map((locale) => conversions.list(locale)),
          Effect.provide(Settings.layer)
        ),
      convertDocument: (strategyId: string, input: ConversionInput, context: ConversionContext) =>
        conversions.convert(strategyId, input, context),
      importCapability: Effect.fnUntraced(function* (
        input: typeof importCapabilityInputSchema.Type
      ) {
        const session = yield* Effect.serviceOption(ChatGptSession);
        const path = decoderPath(input);
        const authentication = (() => {
          if (Option.isNone(session)) return 'unavailable' as const;

          const auth: AuthManager = session.value.manager;

          return auth.sessionConfigured ? ('session_configured' as const) : ('signed_out' as const);
        })();

        return {
          kind: input.kind,
          recognized: input.kind !== 'other',
          status: path !== 'none' && path !== 'vision' ? 'supported' : 'unavailable',
          path,
          reason:
            path === 'none'
              ? 'no_decoder'
              : path === 'vision'
                ? 'provider_unverified'
                : 'local_decoder',
          provider: { authentication, capability: 'unverified' }
        } satisfies typeof importCapabilitySchema.Type;
      }),
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
      createSource: (input: { name: string; bytes: Uint8Array; projectId: ProjectId | null }) =>
        transaction((tx) => {
          const requestId = randomUUID();

          const detected = sniff(input.name, input.bytes);

          const source = tx
            .store(SourceStore)
            .createSource({ ...input, ...detected, origin: 'attachment', uri: null, requestId });

          requested(tx, source.id, 1, requestId);

          return source;
        }),
      addLink: (input: { url: string; projectId: ProjectId | null; name?: string }) =>
        transaction((tx) => {
          const uri = validateLink(input.url);

          const requestId = randomUUID();

          const source = tx.store(SourceStore).createSource({
            name: input.name ?? uri,
            bytes: new TextEncoder().encode(uri),
            kind: 'link',
            mime: 'text/uri-list',
            origin: 'web',
            projectId: input.projectId,
            uri,
            requestId
          });

          requested(tx, source.id, 1, requestId);

          return source;
        }),
      importRecording: (input: {
        requestId: string;

        projectId: ProjectId | null;

        noteId: NoteId;

        name: string;

        bytes: Uint8Array;

        durationMs: number;
      }) =>
        publicationTransaction((tx) => {
          const imports = tx.store(RecordingImportStore);

          const hash = imports.validateRecordingImport(input);

          const receipt = imports.findRecordingImport(input.requestId);

          if (Option.isSome(receipt)) {
            if (!Buffer.from(receipt.value.hash).equals(Buffer.from(hash)))
              throw new StudyError('invalid_input', 'recording request differs from its receipt');

            const source = tx.store(SourceStore).findSource(receipt.value.sourceId);

            if (Option.isNone(source))
              throw new StudyError('invalid_input', 'recording source was deleted');

            return source.value;
          }

          const source = tx.store(SourceStore).createSource({
            ...input,
            kind: 'audio',
            mime: 'audio/wav',
            origin: 'recording',
            uri: null
          });

          imports.saveRecordingImport({ ...input, sourceId: source.id, hash });

          requested(tx, source.id, 1, input.requestId, input.requestId);

          return source;
        }),
      replaceSource: (input: {
        id: SourceId;

        expectedRevision: number;

        name: string;

        bytes: Uint8Array;
      }) =>
        transaction((tx) => {
          const requestId = randomUUID();

          const detected = sniff(input.name.trim(), input.bytes);

          const result = tx
            .store(SourceStore)
            .replaceSourceInput({ ...input, ...detected, requestId });

          requested(tx, input.id, result.revision, requestId);

          return result;
        }),
      previewHistory: (input: typeof sourceHistoryInputSchema.Type) =>
        histories.sourceHistory(input),
      retireHistory: (input: typeof sourceHistoryRetireSchema.Type) =>
        transaction((tx) => {
          const preview = tx.store(SourceHistoryStore).sourceHistory(input);
          const { ids, inputIds } = tx
            .store(SourceHistoryRetirementStore)
            .retiredExtractionCorrelation({
              sourceId: input.sourceId,
              snapshotIds: preview.candidates.map((item) => item.snapshotId)
            });

          Workflows.retireCorrelations(tx, ids, [
            'SourceProcessingRequested',
            'SourceCorrectionRequested',
            'SourceIndexed',
            'SourceProcessingFailed'
          ]);
          // The retained output's content-free SourceIndexed event must remain dispatchable.
          Workflows.retireCorrelations(tx, inputIds, ['SourceCorrectionRequested']);
          Workflows.scrubRetiredCorrelations(tx, ids);
          Workflows.scrubRetiredCorrectionInputs(tx, inputIds);
          const result = tx.store(SourceHistoryStore).retireSourceHistory(input);

          if (result.candidates.length) {
            const eventId = randomUUID();

            tx.emit({
              type: 'SourceHistoryPruned',
              eventId,
              causationId: null,
              correlationId: eventId,
              inputVersion: 1,
              depth: 0,
              sourceId: input.sourceId,
              snapshotIds: result.candidates.map((item) => item.snapshotId)
            });
          }

          return result;
        }),
      previewDeletion: ({ id }: { id: SourceId }) =>
        transaction((tx) => tx.store(SourceDeletionPreviewStore).sourceDeletion(id)),
      deleteSource: (input: { id: SourceId }) =>
        transaction((tx) => {
          const { ids } = tx.store(SourceRetirementStore).sourceRetirement(input.id);
          const deleted = tx.store(SourceStore).deleteSource(input.id);
          const executions = deleted
            ? Workflows.retireCorrelations(tx, ids, [
                'SourceProcessingRequested',
                'SourceCorrectionRequested',
                'SourceProcessingFailed',
                'SourceIndexed',
                'SourceProjectChanged'
              ])
            : [];

          if (deleted) Workflows.scrubRetiredCorrelations(tx, ids);

          if (deleted) {
            const eventId = randomUUID();

            tx.emit({
              type: 'SourceDeleted',
              eventId,
              causationId: null,
              correlationId: eventId,
              inputVersion: 1,
              depth: 0,
              sourceId: input.id
            });
          }

          return { deleted, executions };
        }).pipe(
          Effect.tap(({ executions }) => Workflows.interruptRetiredExecutions(executions)),
          Effect.map(({ deleted }) => deleted)
        ),
      requestSourceProcessing: (input: { id: SourceId; expectedRevision: number }) =>
        transaction((tx) => {
          const requestId = randomUUID();

          const result = tx.store(SourceStore).requestSourceProcessing({ ...input, requestId });

          requested(tx, input.id, result.revision, requestId);

          return result;
        }),
      setSourceProject: (input: typeof setSourceProjectInputSchema.Type) =>
        transaction((tx) => {
          const store = tx.store(SourceStore);

          const before = store.source(input.id);

          const source = store.setSourceProject(input);

          const state = tx.store(SourceProcessingStore).sourceProcessing(input.id);

          if (before.projectId !== input.projectId) {
            const eventId = randomUUID();

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
            const eventId = randomUUID();

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
        }),
      correctBlock: (input: typeof correctBlockInputSchema.Type) =>
        transaction((tx) => {
          const requestId = randomUUID();

          const result = tx.store(SourceStore).requestCorrection({ ...input, requestId });

          tx.emit({
            type: 'SourceCorrectionRequested',
            eventId: randomUUID(),
            causationId: null,
            correlationId: requestId,
            inputVersion: result.revision,
            depth: 0,
            sourceId: input.id,
            requestId,
            documentId: input.documentId,
            ordinal: input.ordinal,
            before: input.before,
            after: input.after
          });

          return result;
        }),
      noticeSourceProcessingFailure: (event: SourcePublicationRequested) =>
        publicationTransaction((tx) => {
          const state = tx.store(SourceProcessingStore).sourceProcessing(event.sourceId);

          if (state.revision !== event.inputVersion || state.requestId !== event.requestId) return;

          const eventId = `source-failed/${event.eventId}`;

          if (tx.store(SourceFailureNoticeStore).sourceFailureNotice(eventId)) return;

          tx.emit({
            type: 'SourceProcessingFailed',
            eventId,
            causationId: event.eventId,
            correlationId: event.correlationId,
            inputVersion: event.inputVersion,
            depth: event.depth + 1,
            sourceId: event.sourceId,
            requestId: event.requestId
          });
        }),
      publishSourceDocument: (input: { event: SourcePublicationRequested; document: Document }) =>
        publicationTransaction((tx) => {
          const source = tx.store(SourceStore).source(input.event.sourceId);

          const { documentId, published } = tx.store(SourceStore).publishSourceDocument({
            id: input.event.sourceId,
            expectedRevision: input.event.inputVersion,
            requestId: input.event.requestId,
            document: input.document
          });

          if (published)
            tx.emit({
              type: 'SourceIndexed',
              eventId: randomUUID(),
              causationId: input.event.eventId,
              correlationId: input.event.correlationId,
              inputVersion: input.event.inputVersion,
              depth: input.event.depth + 1,
              projectId: source.projectId,
              sourceId: input.event.sourceId,
              documentId
            });

          return documentId;
        })
    };
  },
  {
    decodeImportedMarkdown: (bytes: Uint8Array) =>
      decodeText({ bytes, kind: 'text', mime: 'text/markdown' }),
    createImportedInTransaction: (
      tx: Transaction,
      input: { name: string; bytes: Uint8Array; projectId: ProjectId | null }
    ) => {
      const requestId = randomUUID();
      const detected = sniff(input.name, input.bytes);
      const source = tx
        .store(SourceStore)
        .createSource({ ...input, ...detected, origin: 'import', uri: null, requestId });

      tx.emit({
        type: 'SourceProcessingRequested',
        eventId: randomUUID(),
        causationId: null,
        correlationId: requestId,
        inputVersion: 1,
        depth: 0,
        sourceId: source.id,
        requestId
      });

      return source;
    },
    currentExtractionInTransaction: (tx: Transaction, id: SourceId) => {
      tx.store(SourceStore).source(id);

      return Option.getOrNull(tx.store(CurrentExtractionStore).findCurrentExtraction({ id }));
    },
    sourceInTransaction: (tx: Transaction, id: SourceId) => tx.store(SourceStore).source(id),
    extractionInTransaction: (tx: Transaction, v: typeof exactExtractionInputSchema.Type) => {
      tx.store(SourceStore).source(v.sourceId);

      return tx.store(SourceExtractionsStore).extraction(v);
    },
    archiveNoteInTransaction: (
      tx: Transaction,
      v: typeof sourceLinkSchema.Type & { archivedAt: bigint | null }
    ) => tx.store(NoteSourcesStore).archiveNote(v),
    conversionStrategy: conversions.describe,
    conversionStrategyForInput: conversions.forInput,
    attachInTransaction: (tx: Transaction, v: typeof sourceLinkSchema.Type) => {
      tx.store(SourceStore).source(v.sourceId);
      tx.store(NoteSourcesStore).attachSource(v);
    },
    validateBackup: (tx: Transaction) => tx.store(SourceBackupStore).backupAsset(undefined)
  }
);
