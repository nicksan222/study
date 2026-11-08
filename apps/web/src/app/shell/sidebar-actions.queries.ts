import type { ProjectId } from '@study/contracts/ids';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import type { sidebarSubjectDestination } from '#web/lib/navigation/sidebar-config.ts';
import { createProjectMutationOptions } from '#web/lib/study-client/study.queries.ts';

export function useSidebarActions(
  project: ProjectId | undefined,
  subjectDestination: ReturnType<typeof sidebarSubjectDestination>,
  clearSearch: () => void
) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newSubjectOpen, setNewSubjectOpen] = useState(false);
  const [name, setName] = useState('');
  const [actionError, setActionError] = useState(false);
  const subjectMutation = useMutation(createProjectMutationOptions(queryClient));
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
        search: project ? { project: String(project) } : {}
      });
    } catch {
      setActionError(true);
    }
  };
  const createSubject = () => {
    if (!name.trim() || creating) return;

    setActionError(false);
    subjectMutation.mutate(name.trim(), {
      onError: () => setActionError(true),
      onSuccess: (created) => {
        setNewSubjectOpen(false);
        setName('');
        selectSubject(created.id);
      }
    });
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
