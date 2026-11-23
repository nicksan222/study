import { RegistryContext, useAtomValue } from '@effect/atom-react';
import type { ProjectId, NoteId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import {
  Loading,
  toastManager,
  WorkspaceCard,
  WorkspaceSurface,
  useWorkspaceWide
} from '@study/ui';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { DragEvent, ClipboardEvent, ReactNode } from 'react';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { NoteDeletion, NoteDeleteDialog, deletionAttempt, useDeletionReceipt } from './deletion';
import { NoteLayoutControls } from './note-layout-controls';
import { NoteStart } from './start';
import { creationFlow } from './start.queries';
import { NoteReadError } from './status';
import { NoteWorkbench } from './workbench';
import { useWorkbench } from './workbench.queries';
import { WorkspaceHeader } from './workspace-header';

export function NoteWorkspace({ id }: { id?: NoteId } = {}) {
  return id ? (
    <NoteBody key={String(id)} id={id} />
  ) : (
    <NoteUploadRedirect>
      <NoteStart />
    </NoteUploadRedirect>
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
      ) : editable && state.data ? (
        <EditableNote
          id={id}
          owner={owner}
          title={state.data.title}
          project={project}
          onDelete={() => setDeleteDialogOpen(true)}
        />
      ) : (
        <WorkspaceSurface.Root variant="desk">
          <WorkspaceHeader owner={owner} title={state.data?.title} />
          {deletion.data && <NoteDeletion id={id} />}
          <NoteFeedback state={state} deletion={deletion} />
        </WorkspaceSurface.Root>
      )}
    </NoteUploadRedirect>
  );
}

function EditableNote({
  id,
  owner,
  title,
  project,
  onDelete
}: {
  id: NoteId;
  owner: ReturnType<typeof useNoteWorkspace>['owner'];
  title: string;
  project?: ProjectId;
  onDelete: () => void;
}) {
  const workspace = useRef<HTMLDivElement>(null);
  const contextPanel = useRef<HTMLElement>(null);
  const contextToggle = useRef<HTMLButtonElement>(null);
  const cardFollowsWidth = useRef(true);
  const wide = useWorkspaceWide(workspace, () => {
    if (cardFollowsWidth.current && contextPanel.current?.contains(document.activeElement))
      contextToggle.current?.focus();
  });
  const model = useWorkbench(id, wide);

  useLayoutEffect(() => {
    cardFollowsWidth.current = model.cardHidden === undefined;
  }, [model.cardHidden]);

  return (
    <WorkspaceCard.Provider
      open={model.cardVisible}
      onOpenChange={model.toggleCard}
      triggerRef={contextToggle}
    >
      <WorkspaceSurface.Root variant="desk" ref={workspace}>
        <WorkspaceHeader owner={owner} title={title}>
          <NoteLayoutControls model={model} />
        </WorkspaceHeader>
        <NoteWorkbench
          id={id}
          title={title}
          project={project}
          model={model}
          contextPanel={contextPanel}
          onDelete={onDelete}
        />
      </WorkspaceSurface.Root>
    </WorkspaceCard.Provider>
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
