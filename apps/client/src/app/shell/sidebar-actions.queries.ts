import type { ProjectId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import type { sidebarSubjectDestination } from '#client/lib/navigation/sidebar-config.ts';

export function useSidebarActions(
  project: ProjectId | undefined,
  subjectDestination: ReturnType<typeof sidebarSubjectDestination>,
  clearSearch: () => void
) {
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newSubjectOpen, setNewSubjectOpen] = useState(false);
  const [name, setName] = useState('');
  const [actionError, setActionError] = useState(false);
  const subjectMutation = rpc.projects.create.useMutation();
  const creating = subjectMutation.isPending;
  const selectSubject = (id: ProjectId) => {
    setPickerOpen(false);
    clearSearch();

    void navigate({ to: subjectDestination, search: { project: String(id) } });
  };
  const createNote = async () => {
    if (creating) return;

    setActionError(false);
    clearSearch();

    try {
      await navigate({
        to: '/notes',
        search: { project: project?.toString(), notebookDraft: '1' }
      });
    } catch {
      setActionError(true);
    }
  };
  const createSubject = () => {
    if (!name.trim() || creating) return;

    setActionError(false);
    void subjectMutation
      .mutate({ name: name.trim() })
      .then((created) => {
        setNewSubjectOpen(false);
        setName('');
        selectSubject(created.id);
      })
      .catch(() => setActionError(true));
  };

  return {
    pickerOpen,
    setPickerOpen,
    newSubjectOpen,
    setNewSubjectOpen,
    name,
    setName,
    actionError,
    setActionError,
    creating,
    selectSubject,
    createNote,
    createSubject
  };
}
