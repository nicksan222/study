import { useQuery } from '@tanstack/react-query';
import { useParams, useSearch, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { selectedNoteOptions } from '#web/features/note-workspace/index.ts';

/** Keep the router-validated bigint identity and authoritative subject ownership. */
export function usePage() {
  const { noteId } = useParams({ strict: false });
  const { project } = useSearch({ from: '__root__' });
  const state = useQuery(selectedNoteOptions(noteId));
  const navigate = useNavigate();
  const owner =
    state.data?.projectIds.find((id) => String(id) === project) ?? state.data?.projectIds[0];

  useEffect(() => {
    if (noteId !== undefined && owner !== undefined && project !== String(owner)) {
      void navigate({
        to: '/notes/$noteId',
        params: { noteId },
        search: { project: String(owner) },
        replace: true
      });
    }
  }, [owner, project, noteId, navigate]);

  return { id: noteId };
}
