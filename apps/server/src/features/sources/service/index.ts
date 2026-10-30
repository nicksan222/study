import { randomUUID } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import type { SourcePublicationRequested } from '@study/contracts/events';
import type { ProjectId, SessionId, SourceId } from '@study/contracts/ids';
import type { Document } from '@study/contracts/sources/document';
import type {
  sourcePageInputSchema,
  correctBlockInputSchema,
  setSourceProjectInputSchema
} from '@study/contracts/sources/rpc';
import { sniff } from '@study/contracts/sources/sniff';
import { Effect, Option } from 'effect';

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
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';
import {
  transaction,
  useStore,
  publicationTransaction
} from '#server/platform/definitions/define-store';
import { validateLink } from '#server/platform/http/index';

type SourcePageInput = typeof sourcePageInputSchema.Type;

export const Sources = defineService(
  'study/Sources',
  Effect.gen(function* () {
    const sources = yield* useStore(SourceStore);
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
      source: sources.source,
      sourceExport: exports.sourceExport,
      findSource: sources.findSource,
      sources: (input: SourcePageInput) =>
        Effect.gen(function* () {
          const items = yield* sources.sources(input);
          const last = items.at(-1);
          const more =
            last && items.length === input.limit
              ? yield* sources.sources({ limit: 1, before: last.id })
              : [];

          return { items, next: more.length && last ? last.id : null };
        }),
      sourceProcessing: processing.sourceProcessing,
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
        projectId: ProjectId;
        sessionId: SessionId;
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
      deleteSource: (input: { id: SourceId }) =>
        transaction((tx) => {
          const deleted = tx.store(SourceStore).deleteSource(input.id);

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

          return deleted;
        }),
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

          if (
            before.projectId !== input.projectId &&
            input.projectId !== null &&
            state.documentId !== null
          ) {
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

          if (source.projectId !== null && published)
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
  })
);
