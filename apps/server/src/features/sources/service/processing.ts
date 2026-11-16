/** @file Owns processing within this feature. */

import type {
  Document,
  SourceId,
  SourcePublicationRequested,
  correctBlockInputSchema
} from '@study/contracts';
import { publicationTransaction, transaction } from '@study/server';

import {
  SourceFailureNoticeStore,
  SourceProcessingStore,
  SourceStore
} from '#server/features/sources/store/index';

import { requested } from './processing-events.ts';

export function sourceProcessingOperations() {
  return {
    requestSourceProcessing: (input: { id: SourceId; expectedRevision: number }) =>
      transaction((tx) => {
        const requestId = crypto.randomUUID();

        const result = tx.store(SourceStore).requestSourceProcessing({ ...input, requestId });

        requested(tx, input.id, result.revision, requestId);

        return result;
      }),
    correctBlock: (input: typeof correctBlockInputSchema.Type) =>
      transaction((tx) => {
        const requestId = crypto.randomUUID();

        const result = tx.store(SourceStore).requestCorrection({ ...input, requestId });

        tx.emit({
          type: 'SourceCorrectionRequested',
          eventId: crypto.randomUUID(),
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
            eventId: crypto.randomUUID(),
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
}
