import { useParams } from '@tanstack/react-router';

/** Keep the router-validated bigint identity; the session index has no selected session. */
export function usePage() {
  const { sessionId } = useParams({ strict: false });

  return { id: sessionId };
}
