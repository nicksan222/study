import { RegistryContext, useAtomValue } from '@effect/atom-react';
import type { ProjectId, NoteId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Loading, toastManager, WorkspaceCard, WorkspaceSurface } from '@study/ui';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { DragEvent, ClipboardEvent, ReactNode } from 'react';
import { useContext, useEffect, useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { NoteDeletion, NoteDeleteDialog, deletionAttempt, useDeletionReceipt } from './deletion';
import { NoteLayoutControls } from './note-layout-controls';
import { NoteStart } from './start';
import { creationFlow } from './start.queries';
import { NoteReadError } from './status';
import { NoteWorkbench } from './workbench';
import { WorkspaceHeader } from './workspace-header';

/** Keeps the starter and active notebook under the same context-panel owner. */
export function NoteWorkspace({ id }: { id?: NoteId } = {}) {
  return (
    <WorkspaceCard.Provider>
      {id ? (
        <NoteBody key={String(id)} id={id} />
      ) : (
        <NoteUploadRedirect>
          <NoteStart />
        </NoteUploadRedirect>
      )}
    </WorkspaceCard.Provider>
  );
}

function NoteUploadRedirect({ project, children }: { project?: ProjectId; children: ReactNode }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const search = useSearch({ from: '__root__' });
  const help = () =>
    toastManager.add({
      id: 'note-material-upload',
      title: t('NoteUploadFromMaterials'),
      type: 'info',
      actionProps: {
        children: t('UploadedMaterials'),
        onClick: () =>
          void navigate({
            to: '/uploads',
            search: { project: project ? String(project) : search.project }
          })
      }
    });
  const onDrop = (event: DragEvent) => {
    if (!event.dataTransfer.files.length) return;

    event.preventDefault();
    help();
  };
  const onPaste = (event: ClipboardEvent) => {
    if (!event.clipboardData.files.length) return;

    if (!event.clipboardData.getData('text/plain')) event.preventDefault();

    help();
  };

  return (
    <WorkspaceSurface.Container
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      {children}
    </WorkspaceSurface.Container>
  );
}

/** Combines authoritative note and deletion reads before allowing edits. */
function useNoteWorkspace(id: NoteId) {
  const state = rpc.notes.get.useQuery({ id: id });
  const search = useSearch({ from: '__root__' });
  const subjects = rpc.projects.list.useQuery({ limit: 100 });
  const project =
    state.data?.projectIds.find((id) => String(id) === search.project) ?? state.data?.projectIds[0];
  const owner = subjects.data?.items.find((subject) => subject.id === project);
  const cache = useContext(RegistryContext);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const attempt = useAtomValue(deletionAttempt(id));
  const deletePending = attempt.pending;
  const deletion = useDeletionReceipt(id, true);
  const completed = deletion.data?.status === 'completed';

  useCompletedDeletion(completed, project);
  const live = deletion.isSuccess && deletion.data === null;
  const editable = !!state.data && !state.isError && live && !deletePending && !attempt.started;

  useEffect(() => {
    if (state.isSuccess) {
      const created = cache.get(creationFlow);

      if (created?.id === id) cache.set(creationFlow, {});
    }
  }, [cache, id, state.isSuccess]);

  return {
    state,
    owner,
    project,
    deleteDialogOpen,
    setDeleteDialogOpen,
    deletion,
    editable,
    completed
  };
}

/** Keeps deletion ownership mounted while replacing completed notebooks with the starter. */
function NoteBody({ id }: { id: NoteId }) {
  const {
    state,
    owner,
    project,
    deleteDialogOpen,
    setDeleteDialogOpen,
    deletion,
    editable,
    completed
  } = useNoteWorkspace(id);

  return (
    <NoteUploadRedirect project={project}>
      <NoteDeleteDialog id={id} open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} />
      {completed ? (
        <NoteStart />
      ) : (
        <WorkspaceSurface.Root variant="desk">
          <WorkspaceHeader owner={owner} title={state.data?.title}>
            {editable && <NoteLayoutControls id={id} />}
          </WorkspaceHeader>
          {deletion.data && <NoteDeletion id={id} />}
          <NoteFeedback state={state} deletion={deletion} />
          {editable && state.data && (
            <NoteWorkbench
              id={id}
              title={state.data.title}
              project={project}
              onDelete={() => setDeleteDialogOpen(true)}
            />
          )}
        </WorkspaceSurface.Root>
      )}
    </NoteUploadRedirect>
  );
}

/** Refreshes navigation hints and leaves the deleted URL without losing its subject scope. */
function useCompletedDeletion(completed: boolean, project: ProjectId | undefined) {
  const cache = useContext(RegistryContext);
  const navigate = useNavigate();
  const search = useSearch({ from: '__root__' });

  useEffect(() => {
    if (!completed) return;

    const subject = project ? String(project) : search.project;

    void navigate({ to: '/notes', search: subject ? { project: subject } : {}, replace: true });
  }, [completed, cache, navigate, project, search.project]);
}

/** Presents independent note and deletion read failures without exposing editable content. */
function NoteFeedback({
  state,
  deletion
}: Pick<ReturnType<typeof useNoteWorkspace>, 'state' | 'deletion'>) {
  const { t } = useI18n();

  return (
    <>
      {(state.isPending || deletion.isPending) && (
        <Loading label={t('LoadingStudy')} layout="panel" />
      )}
      {deletion.error && (
        <NoteReadError error={deletion.error} retry={() => void deletion.refetch()} />
      )}
      {state.error && <NoteReadError error={state.error} retry={() => void state.refetch()} />}
    </>
  );
}
