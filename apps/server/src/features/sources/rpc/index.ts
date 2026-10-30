import type { StudyError } from '@study/contracts/errors';
import { SourcesRpc } from '@study/contracts/sources/rpc';
import { Effect } from 'effect';

import { Sources } from '#server/features/sources/service/index';

const failure = (error: StudyError) => ({
  kind: error.kind,
  message: error.message,
  retryAfterMs: error.retryAfterMs
});

export const SourcesRpcLive = SourcesRpc.toLayer(
  Effect.gen(function* () {
    const sources = yield* Sources;

    return {
      'sources.sourceExport': ({ id }) => sources.sourceExport(id).pipe(Effect.mapError(failure)),
      'sources.source': ({ id }) => sources.source(id).pipe(Effect.mapError(failure)),
      'sources.findSource': ({ id }) => sources.findSource(id).pipe(Effect.mapError(failure)),
      'sources.sources': (input) => sources.sources(input).pipe(Effect.mapError(failure)),
      'sources.sourceProcessing': ({ id }) =>
        sources.sourceProcessing(id).pipe(Effect.mapError(failure)),
      'sources.addLink': (input) => sources.addLink(input).pipe(Effect.mapError(failure)),
      'sources.createSource': (input) => sources.createSource(input).pipe(Effect.mapError(failure)),
      'sources.replaceSource': (input) =>
        sources.replaceSource(input).pipe(Effect.mapError(failure)),
      'sources.setSourceProject': (input) =>
        sources.setSourceProject(input).pipe(Effect.mapError(failure)),
      'sources.correctBlock': (input) => sources.correctBlock(input).pipe(Effect.mapError(failure)),
      'sources.deleteSource': (input) => sources.deleteSource(input).pipe(Effect.mapError(failure)),
      'sources.requestSourceProcessing': (input) =>
        sources.requestSourceProcessing(input).pipe(Effect.mapError(failure))
    };
  })
);
