import { useQuery } from '@tanstack/react-query';
import { useParams, useSearch, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { sessionOptions } from '#web/features/session-workspace/index.ts';

/** Keep the router-validated bigint identity and authoritative subject ownership. */
export function usePage() {
  const { sessionId } = useParams({ strict: false });
  const { project } = useSearch({ from: '__root__' });
  const state = useQuery({ ...sessionOptions(sessionId!), enabled: sessionId !== undefined });
  const navigate = useNavigate();
  const owner =
    state.data?.projectIds.find((id) => String(id) === project) ?? state.data?.projectIds[0];

  useEffect(() => {
    if (sessionId !== undefined && owner !== undefined && project !== String(owner)) {
      void navigate({
        to: '/session/$sessionId',
        params: { sessionId },
        search: { project: String(owner) },
        replace: true
      });
    }
  }, [owner, project, sessionId, navigate]);

  return { id: sessionId };
}
