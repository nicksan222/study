import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch, useParams } from '@tanstack/react-router';
import { useEffect } from 'react';

import { sessionOptions } from '#web/features/session-workspace/index.ts';

/** Keep the router-validated bigint identity; the session index has no selected session. */
export function usePage() {
  const { sessionId } = useParams({ strict: false });

  const project = useSearch({ from: '__root__', select: (search) => search.project });
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
