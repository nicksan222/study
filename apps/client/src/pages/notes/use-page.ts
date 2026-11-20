import { noteIdSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useParams, useSearch, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

/** Keep the router-validated bigint identity and authoritative subject ownership. */
export function usePage() {
  const { noteId } = useParams({ strict: false });
  const { project } = useSearch({ from: '__root__' });
  const state = rpc.notes.get.useQuery(
    { id: noteIdSchema.make(BigInt(noteId ?? '1')) },
    { enabled: noteId !== undefined }
  );
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

export function useNotebookDraft() {
  return useSearch({ from: '__root__', select: (search) => search.notebookDraft === '1' });
}
