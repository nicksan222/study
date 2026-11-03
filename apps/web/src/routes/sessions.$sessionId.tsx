import { sessionIdSchema } from '@study/contracts/ids';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { Schema } from 'effect';

import { Page } from '../pages/sessions/page';

export const Route = createFileRoute('/sessions/$sessionId')({
  staticData: { title: 'Sessions', section: 'sessions', scope: 'project' },
  params: {
    parse: ({ sessionId }) => {
      if (!/^[1-9][0-9]{0,18}$/.test(sessionId)) throw notFound();
      const id = BigInt(sessionId);
      if (!Schema.is(sessionIdSchema)(id)) throw notFound();
      return { sessionId: id };
    },
    stringify: ({ sessionId }) => ({ sessionId: String(sessionId) })
  },
  component: SessionPage
});

function SessionPage() {
  const { sessionId } = Route.useParams();
  return <Page id={sessionId} />;
}
