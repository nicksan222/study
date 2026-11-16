/** @file Owns publication within this feature. */

import type {
  Failure,
  documentSchema,
  sourceCorrectionRequestedSchema,
  sourceProcessingRequestedSchema
} from '@study/contracts';
import { contentSnapshotIdSchema } from '@study/contracts';
import { Effect, Schema } from 'effect';

import { Sources } from '#server/features/sources/service/index';
import { Database } from '#server/platform/database/database';
import { publicationActivity } from '#server/platform/definitions/define-activity';

export function noticeSourceFailure(
  event: typeof sourceProcessingRequestedSchema.Type | typeof sourceCorrectionRequestedSchema.Type
) {
  return Effect.catch(
    Effect.fnUntraced(function* (error: Failure) {
      if (!['auth', 'config', 'model_unavailable', 'cancelled'].includes(error.kind)) {
        const sources = yield* Sources;
        const { store } = yield* Database;

        yield* publicationActivity(store, {
          name: 'notice-source-failure',
          success: Schema.Void,

          execute: sources
            .noticeSourceProcessingFailure(event)
            .pipe(
              Effect.catch((cause) =>
                cause.kind === 'not_found' ? Effect.void : Effect.fail(cause)
              )
            )
        });
      }

      return yield* Effect.fail(error);
    })
  );
}

export function publishSource(
  event: typeof sourceProcessingRequestedSchema.Type | typeof sourceCorrectionRequestedSchema.Type,
  document: typeof documentSchema.Type
) {
  return Effect.gen(function* () {
    const sources = yield* Sources;
    const { store } = yield* Database;

    return yield* publicationActivity(store, {
      name: 'publish-source',
      success: contentSnapshotIdSchema,

      execute: sources.publishSourceDocument({ event, document })
    });
  });
}
