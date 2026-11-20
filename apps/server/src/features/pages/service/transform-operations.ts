/** @file Owns transform operations within this feature. */

import type * as t from '@study/contracts';
import type { ProjectId } from '@study/contracts';
import { StudyError } from '@study/contracts';
import { publicationTransaction, transaction, useStore } from '@study/server';
import { Effect, Option } from 'effect';

import { PagesStore } from '#server/features/pages/store/index';
import { PageMergesStore } from '#server/features/pages/store/merges';
import { PageTransformsStore } from '#server/features/pages/store/transforms';
import { Workflows } from '#server/features/workflows/index';

import { standaloneTransformContext, requestImprovement, requestMerge } from './merge.ts';
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
    improvement: (v: typeof t.improvementScopeSchema.Type) =>
      transaction((tx) => {
        const page = tx.store(PagesStore).page({ id: v.pageId });

        if (v.projectId !== undefined && !page.projectIds.includes(v.projectId))
          throw new StudyError('not_found', 'Document is unavailable in this subject');

        return Option.getOrNull(tx.store(PageTransformsStore).improvement(v));
      }),
    improve: (v: typeof t.improvePageSchema.Type) => transaction((tx) => requestImprovement(tx, v)),
    standaloneTransformContext: (v: typeof t.transformKeySchema.Type) =>
      transaction((tx) => standaloneTransformContext(tx, v)),
    publishStandaloneTransform: (v: typeof t.transformPublicationSchema.Type) =>
      publicationTransaction((tx) => {
        const request = tx.store(PageTransformsStore).transform(v);

        if (!request.merge && !request.improvement)
          throw new StudyError('invalid_input', 'No standalone transform capture');

        return publishTransform(
          tx,
          request.resultVersionId === null ? standaloneTransformContext(tx, v) : undefined,
          v
        );
      }),
    retryStandaloneTransform: (v: { requestId: string; retryId: string }) =>
      transaction((tx) => {
        const request = tx.store(PageTransformsStore).transform(v);

        if (!request.merge && !request.improvement)
          throw new StudyError('invalid_input', 'No standalone transform capture');

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
