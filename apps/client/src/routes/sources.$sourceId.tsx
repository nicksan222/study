import { sourceIdSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { createFileRoute } from '@tanstack/react-router';
import { Schema } from 'effect';

import { SourcePage } from '../features/source-library';

export const Route = createFileRoute('/sources/$sourceId')({
  staticData: { title: 'AnswerSources', section: 'notes', scope: 'global' },
  beforeLoad: ({ params }) => {
    Schema.decodeUnknownSync(sourceIdSchema)(BigInt(params.sourceId));
  },
  loaderDeps: ({ search }) => ({
    sourceRevision: search.sourceRevision,
    sourceSnapshot: search.sourceSnapshot
  }),
  loader: ({ params }) =>
    rpc.sources.get
      .read({ id: sourceIdSchema.make(BigInt(params.sourceId)) })
      .catch(() => undefined),
  component: SourcePage
});
