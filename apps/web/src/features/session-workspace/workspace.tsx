import type { SessionId } from '@study/contracts/ids';
import { WorkspaceCard, WorkspaceSurface } from '@study/ui/workspace';
import { useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { projectsQueryOptions } from '../../lib/study-client/study.queries';
import { useAttachments } from './attachments';
import { Composer } from './composer';
import { SessionContextActions } from './context-actions';
import { SessionDeletion, SessionDeleteDialog } from './deletion';
import type { Draft } from './draft';
import { History } from './history';
import {
  deletionOptions,
  deletionAttemptOptions,
  sessionKey,
  sessionOptions
} from './session-workspace.queries';
import { SessionStart } from './start';
import { SessionReadError } from './status';
import { WorkspaceContext } from './workspace-context';
import { WorkspaceFooter } from './workspace-footer';
import { WorkspaceHeader } from './workspace-header';

export function SessionWorkspace({ id }: { id?: SessionId } = {}) {
  return (
    <WorkspaceCard.Provider>
      <div className="session-workspace">
        {id ? <SessionBody key={String(id)} id={id} /> : <SessionStart />}
      </div>
    </WorkspaceCard.Provider>
  );
}

function SessionBody({ id }: { id: SessionId }) {
  const { t } = useI18n();
  const state = useQuery(sessionOptions(id));
  const search = useSearch({ from: '__root__' });
  const navigate = useNavigate();
  const subjects = useQuery(projectsQueryOptions());
  const project =
    state.data?.projectIds.find((id) => String(id) === search.project) ?? state.data?.projectIds[0];
  const owner = subjects.data?.find((subject) => subject.id === project);
  const cache = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deletePending =
    useIsMutating({ mutationKey: [...sessionKey(id), 'delete'], exact: true }) > 0;
  const files = useAttachments(id);
  const deletion = useQuery(deletionOptions(id, true));
  const deleteAttempt = useQuery(deletionAttemptOptions(id));
  const completed = deletion.data?.status === 'completed';
  useEffect(() => {
    if (!completed) return;
    void cache.invalidateQueries({ queryKey: ['sessions'] });
    void cache.invalidateQueries({ queryKey: ['search'] });
    const subject = project ? String(project) : search.project;
    void navigate({ to: '/sessions', search: subject ? { project: subject } : {}, replace: true });
  }, [completed, cache, navigate, project, search.project]);
  const live = deletion.isSuccess && deletion.data === null;
  const editable = !!state.data && !state.isError && live && !deletePending && !deleteAttempt.data;
  useEffect(() => {
    if (state.isSuccess) {
      const created = cache.getQueryData<{ id?: SessionId }>(['session-workspace', 'creation']);
      if (created?.id === id) cache.setQueryData(['session-workspace', 'creation'], {});
    }
  }, [cache, id, state.isSuccess]);
  if (completed) {
    return (
      <>
        <SessionStart />
        <SessionDeleteDialog id={id} open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} />
      </>
    );
  }
  return (
    <WorkspaceSurface.Root
      variant="session"
      className="session-canvas"
      onDragOver={(event) => {
        if (live && !deletePending) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const draft = cache.getQueryData<Draft>(['session-drafts', String(id), 'note']);
        if (editable && canAttachDraft(draft)) files.add(Array.from(event.dataTransfer.files));
      }}
    >
      {live && (
        <WorkspaceContext id={id}>
          {editable && <SessionContextActions id={id} onDelete={() => setDeleteDialogOpen(true)} />}
        </WorkspaceContext>
      )}
      <WorkspaceHeader owner={owner} title={state.data?.title}>
        {live && <WorkspaceCard.Toggle label={t('SessionContextPanel')} />}
      </WorkspaceHeader>
      {deletion.data && <SessionDeletion id={id} />}
      <SessionDeleteDialog id={id} open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} />
      {(state.isPending || deletion.isPending) && <p role="status">{t('LoadingStudy')}</p>}
      {deletion.error && (
        <SessionReadError error={deletion.error} retry={() => void deletion.refetch()} />
      )}
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
      {editable && (
        <>
          <WorkspaceSurface.Body>
            <History id={id} />
          </WorkspaceSurface.Body>
          <WorkspaceSurface.Dock>
            <Composer id={id} />
            <WorkspaceFooter />
          </WorkspaceSurface.Dock>
        </>
      )}
    </WorkspaceSurface.Root>
  );
}

function canAttachDraft(draft: Draft | undefined) {
  return !draft?.pending && !draft?.askAttempt && draft?.noteAttempt === undefined;
}
