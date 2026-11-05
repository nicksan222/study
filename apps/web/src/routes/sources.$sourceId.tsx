import { sourceIdSchema } from '@study/contracts/ids';
import { createFileRoute } from '@tanstack/react-router';
import { Schema } from 'effect';

import { SourcePage, sourceOptions } from '../features/source-library';

export const Route = createFileRoute('/sources/$sourceId')({
  staticData: { title: 'AnswerSources', section: 'sessions', scope: 'global' },
  beforeLoad: ({ params }) => {
    Schema.decodeUnknownSync(sourceIdSchema)(BigInt(params.sourceId));
  },
  loaderDeps: ({ search }) => ({
    sourceRevision: search.sourceRevision,
    sourceSnapshot: search.sourceSnapshot
  }),
  loader: ({ context, params }) =>
    context.queryClient.prefetchQuery(
      sourceOptions(Schema.decodeUnknownSync(sourceIdSchema)(BigInt(params.sourceId)))
    ),
  component: SourcePage
});
