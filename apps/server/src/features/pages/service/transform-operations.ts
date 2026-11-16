/** @file Owns transform operations within this feature. */

import type * as t from '@study/contracts';
import type { ProjectId } from '@study/contracts';
import { StudyError } from '@study/contracts';
import { publicationTransaction, transaction, useStore } from '@study/server';
import { Effect } from 'effect';

import { PageMergesStore } from '#server/features/pages/store/merges';
import { PageTransformsStore } from '#server/features/pages/store/transforms';
import { Workflows } from '#server/features/workflows/index';

import { mergeContext, requestMerge } from './merge.ts';
import { publishTransform, retryTransform } from './transforms.ts';

export function* pageTransformOperations() {
  const transforms = yield* useStore(PageTransformsStore);

  const merges = yield* useStore(PageMergesStore);

  return {
    merges: Effect.fnUntraced(function* (v: { projectId?: ProjectId }) {
      const pending: (typeof t.transformSnapshotSchema.Type)[] = [];
      let page;

      do {
        page = yield* merges.merges({
          ...v,
          pending: true,
          offset: pending.length,
          limit: 1000
        });
        pending.push(...page);
      } while (page.length === 1000);

      const completed = yield* merges.merges({ ...v, pending: false, offset: 0, limit: 3 });

      return [...pending, ...completed];
    }),
    merge: (v: typeof t.mergeRequestSchema.Type) => transaction((tx) => requestMerge(tx, v)),
    mergeContext: (v: typeof t.transformKeySchema.Type) => transaction((tx) => mergeContext(tx, v)),
    publishMerge: (v: typeof t.transformPublicationSchema.Type) =>
      publicationTransaction((tx) => {
        const request = tx.store(PageTransformsStore).transform(v);

        if (!request.merge) throw new StudyError('invalid_input', 'Not a page merge');

        return publishTransform(
          tx,
          request.resultVersionId === null ? mergeContext(tx, v) : undefined,
          v
        );
      }),
    retryMerge: (v: { requestId: string; retryId: string }) =>
      transaction((tx) => {
        const request = tx.store(PageTransformsStore).transform(v);

        if (!request.merge) throw new StudyError('invalid_input', 'Not a page merge');

        return retryTransform(tx, v);
      }),
    transform: transforms.transform,
    cancelTransform: Effect.fnUntraced(function* (v: typeof t.transformKeySchema.Type) {
      const request = yield* transaction((tx) =>
        tx.store(PageTransformsStore).changeTransform({ ...v, cancel: true, errorKind: null })
      );

      if (request.resultVersionId === null)
        yield* Workflows.cancelCorrelatedExecutions(request.id, 'document-transform/v1');

      return request;
    }),
    failTransform: (v: {
      requestId: string;
      eventId: string;
      errorKind: typeof t.transformSnapshotSchema.Type.errorKind;
    }) =>
      publicationTransaction((tx) => {
        const old = tx.store(PageTransformsStore).transform(v);

        if (old.eventId !== v.eventId || old.cancelled || old.resultVersionId !== null) return;

        tx.store(PageTransformsStore).changeTransform({ ...v, cancel: false });
        tx.emit({
          type: 'PageGenerationFailed',
          eventId: `document-failed/${v.eventId}`,
          causationId: v.eventId,
          correlationId: v.requestId,
          inputVersion: 1,
          depth: 1,
          requestId: v.requestId,
          generationEventId: v.eventId,
          errorKind: v.errorKind ?? 'internal'
        });
      })
  };
}
