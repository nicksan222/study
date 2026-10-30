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
import { Database } from '#server/platform/database/database';
import { defineService } from '#server/platform/definitions/define-service';
import { transaction } from '#server/platform/definitions/define-store';
import { validateLink } from '#server/platform/http/index';
import { emitEvent } from '#server/platform/workflows/events';
import { PublicationGuard } from '#server/platform/workflows/publication';

type SourcePageInput = typeof sourcePageInputSchema.Type;

export const Sources = defineService(
  'study/Sources',
  Effect.gen(function* () {
    const { store: context } = yield* Database;
    const sources = SourceStore.make(context);
    const exports = SourceExportStore.make(context);
    const processing = SourceProcessingStore.make(context);
    const snapshots = SourceSnapshotStore.make(context);
    const documents = SourceDocumentStore.make(context);
    const historical = HistoricalDocumentStore.make(context);
    const requested = (
      sourceId: SourceId,
      revision: number,
      requestId: string,
      causationId: string | null = null
    ) => {
      emitEvent(
        context,
        {
          type: 'SourceProcessingRequested',
          eventId: randomUUID(),
          causationId,
          correlationId: requestId,
          inputVersion: revision,
          depth: causationId === null ? 0 : 1,
          sourceId,
          requestId
        },
        context.clock.currentTimeMillisUnsafe()
      );
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
        transaction(context, (tx) => {
          const requestId = randomUUID();
          const detected = sniff(input.name, input.bytes);
          const source = tx
            .store(SourceStore)
            .createSource({ ...input, ...detected, origin: 'attachment', uri: null, requestId });

          requested(source.id, 1, requestId);

          return source;
        }),
      addLink: (input: { url: string; projectId: ProjectId | null; name?: string }) =>
        transaction(context, (tx) => {
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

          requested(source.id, 1, requestId);

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
        Effect.gen(function* () {
          const guard = yield* PublicationGuard;

          return yield* transaction(context, (tx) => {
            guard.assert();
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
            requested(source.id, 1, input.requestId, input.requestId);

            return source;
          });
        }),
      replaceSource: (input: {
        id: SourceId;
        expectedRevision: number;
        name: string;
        bytes: Uint8Array;
      }) =>
        transaction(context, (tx) => {
          const requestId = randomUUID();
          const detected = sniff(input.name.trim(), input.bytes);
          const result = tx
            .store(SourceStore)
            .replaceSourceInput({ ...input, ...detected, requestId });

          requested(input.id, result.revision, requestId);

          return result;
        }),
      deleteSource: (input: { id: SourceId }) =>
        transaction(context, (tx) => {
          const deleted = tx.store(SourceStore).deleteSource(input.id);

          if (deleted) {
            const eventId = randomUUID();

            emitEvent(
              context,
              {
                type: 'SourceDeleted',
                eventId,
                causationId: null,
                correlationId: eventId,
                inputVersion: 1,
                depth: 0,
                sourceId: input.id
              },
              context.clock.currentTimeMillisUnsafe()
            );
          }

          return deleted;
        }),
      requestSourceProcessing: (input: { id: SourceId; expectedRevision: number }) =>
        transaction(context, (tx) => {
          const requestId = randomUUID();
          const result = tx.store(SourceStore).requestSourceProcessing({ ...input, requestId });

          requested(input.id, result.revision, requestId);

          return result;
        }),
      setSourceProject: (input: typeof setSourceProjectInputSchema.Type) =>
        transaction(context, (tx) => {
          const store = tx.store(SourceStore);
          const before = store.source(input.id);
          const source = store.setSourceProject(input);
          const state = tx.store(SourceProcessingStore).sourceProcessing(input.id);

          if (before.projectId !== input.projectId) {
            const eventId = randomUUID();

            emitEvent(
              context,
              {
                type: 'SourceProjectChanged',
                eventId,
                causationId: null,
                correlationId: eventId,
                inputVersion: state.revision,
                depth: 0,
                sourceId: input.id
              },
              context.clock.currentTimeMillisUnsafe()
            );
          }

          if (
            before.projectId !== input.projectId &&
            input.projectId !== null &&
            state.documentId !== null
          ) {
            const eventId = randomUUID();

            emitEvent(
              context,
              {
                type: 'SourceIndexed',
                eventId,
                causationId: null,
                correlationId: eventId,
                inputVersion: state.revision,
                depth: 0,
                projectId: input.projectId,
                sourceId: input.id,
                documentId: state.documentId
              },
              context.clock.currentTimeMillisUnsafe()
            );
          }

          return source;
        }),
      correctBlock: (input: typeof correctBlockInputSchema.Type) =>
        transaction(context, (tx) => {
          const requestId = randomUUID();
          const result = tx.store(SourceStore).requestCorrection({ ...input, requestId });

          emitEvent(
            context,
            {
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
            },
            context.clock.currentTimeMillisUnsafe()
          );

          return result;
        }),
      noticeSourceProcessingFailure: (event: SourcePublicationRequested) =>
        Effect.gen(function* () {
          const guard = yield* PublicationGuard;

          return yield* transaction(context, (tx) => {
            guard.assert();
            const state = tx.store(SourceProcessingStore).sourceProcessing(event.sourceId);

            if (state.revision !== event.inputVersion || state.requestId !== event.requestId)
              return;

            const eventId = `source-failed/${event.eventId}`;

            if (tx.store(SourceFailureNoticeStore).sourceFailureNotice(eventId)) return;

            emitEvent(
              context,
              {
                type: 'SourceProcessingFailed',
                eventId,
                causationId: event.eventId,
                correlationId: event.correlationId,
                inputVersion: event.inputVersion,
                depth: event.depth + 1,
                sourceId: event.sourceId,
                requestId: event.requestId
              },
              context.clock.currentTimeMillisUnsafe()
            );
          });
        }),
      publishSourceDocument: (input: { event: SourcePublicationRequested; document: Document }) =>
        Effect.gen(function* () {
          const guard = yield* PublicationGuard;

          return yield* transaction(context, (tx) => {
            guard.assert();
            const source = tx.store(SourceStore).source(input.event.sourceId);
            const { documentId, published } = tx.store(SourceStore).publishSourceDocument({
              id: input.event.sourceId,
              expectedRevision: input.event.inputVersion,
              requestId: input.event.requestId,
              document: input.document
            });

            if (source.projectId !== null && published)
              emitEvent(
                context,
                {
                  type: 'SourceIndexed',
                  eventId: randomUUID(),
                  causationId: input.event.eventId,
                  correlationId: input.event.correlationId,
                  inputVersion: input.event.inputVersion,
                  depth: input.event.depth + 1,
                  projectId: source.projectId,
                  sourceId: input.event.sourceId,
                  documentId
                },
                context.clock.currentTimeMillisUnsafe()
              );

            return documentId;
          });
        })
    };
  })
);
