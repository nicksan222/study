import { sessionIdSchema } from '@study/contracts/ids';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import { Schema } from 'effect';
import { useEffect } from 'react';

import { sessionOptions } from '../features/session-workspace';
import { sidebarOwner } from '../lib/study-client/sidebar-owner.queries';
import { Page } from '../pages/sessions/page';

export const Route = createFileRoute('/session/$sessionId')({
  staticData: {
    title: 'Sessions',
    section: 'sessions',
    scope: 'project',
    sidebar: {
      owner: sidebarOwner(sessionIdSchema, ({ sessionId }) => sessionId, sessionOptions)
    }
  },
  params: {
    parse: ({ sessionId }) => {
      if (!/^[1-9][0-9]{0,18}$/.test(sessionId)) throw notFound();

      const id = BigInt(sessionId);

      if (!Schema.is(sessionIdSchema)(id)) throw notFound();

      return { sessionId: id };
    },
    stringify: ({ sessionId }) => ({ sessionId: String(sessionId) })
  },
  component: SessionRoute
});

/** Resolves canonical ownership without blocking the existing detail or its loading/error UI. */
function SessionRoute() {
  const { sessionId } = Route.useParams();
  const project = Route.useSearch({ select: (search) => search.project });
  const state = useQuery(sessionOptions(sessionId));
  const navigate = useNavigate();
  const owner =
    state.data?.projectIds.find((id) => String(id) === project) ?? state.data?.projectIds[0];

  useEffect(() => {
    if (owner !== undefined && project !== String(owner)) {
      void navigate({
        to: '/session/$sessionId',
        params: { sessionId },
        search: { project: String(owner) },
        replace: true
      });
    }
  }, [owner, project, sessionId, navigate]);

  return <Page />;
}
