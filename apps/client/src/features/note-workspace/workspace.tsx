import { RegistryContext, useAtomValue } from '@effect/atom-react';
import type { ProjectId, NoteId } from '@study/contracts/ids';
import { rpc } from '@study/contracts/react';
import { Loading } from '@study/ui/loading';
import { WorkspaceCard, WorkspaceSurface } from '@study/ui/workspace';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useContext, useEffect, useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { useAttachments } from './attachments';
import { composerDraft } from './composer.queries';
import { NoteDeletion, NoteDeleteDialog, deletionAttempt, useDeletionReceipt } from './deletion';
import type { Draft } from './draft';
import { NoteLayoutControls } from './note-layout-controls';
import { NoteTitleEdit } from './note-title';
import { NoteStart } from './start';
import { creationFlow } from './start.queries';
import { NoteReadError } from './status';
import { NoteWorkbench } from './workbench';
import { WorkspaceHeader } from './workspace-header';

/** Keeps the starter and active notebook under the same context-panel owner. */
export function NoteWorkspace({ id }: { id?: NoteId } = {}) {
  return (
    <WorkspaceCard.Provider>
      <WorkspaceSurface.Container>
        {id ? <NoteBody key={String(id)} id={id} /> : <NoteStart />}
      </WorkspaceSurface.Container>
    </WorkspaceCard.Provider>
  );
}

/** Combines authoritative note and deletion reads before allowing edits or file drops. */
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
  const files = useAttachments(id);
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
    cache,
    deleteDialogOpen,
    setDeleteDialogOpen,
    deletePending,
    files,
    deletion,
    live,
    editable,
    completed
  };
}

/** Keeps deletion ownership mounted while replacing completed notebooks with the starter. */
function NoteBody({ id }: { id: NoteId }) {
  const {
    state,
    owner,
    cache,
    deleteDialogOpen,
    setDeleteDialogOpen,
    deletePending,
    files,
    deletion,
    live,
    editable,
    completed
  } = useNoteWorkspace(id);

  return (
    <>
      <NoteDeleteDialog id={id} open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} />
      {completed ? (
        <NoteStart />
      ) : (
        <WorkspaceSurface.Root
          variant="desk"
          onDragOver={(event) => {
            if (live && !deletePending) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            const draft = cache.get(composerDraft(id));

            if (editable && canAttachDraft(draft)) files.add(Array.from(event.dataTransfer.files));
          }}
        >
          <WorkspaceHeader
            owner={owner}
            title={state.data?.title}
            titleAction={
              editable && state.data && <NoteTitleEdit id={id} title={state.data.title} />
            }
          >
            {editable && <NoteLayoutControls id={id} />}
          </WorkspaceHeader>
          {deletion.data && <NoteDeletion id={id} />}
          <NoteFeedback state={state} deletion={deletion} />
          {editable && <NoteWorkbench id={id} onDelete={() => setDeleteDialogOpen(true)} />}
        </WorkspaceSurface.Root>
      )}
    </>
  );
}

/** Protects drafts whose pending or uncertain writes already own their attachments. */
function canAttachDraft(draft: Draft | undefined) {
  return !draft?.pending && !draft?.askAttempt && draft?.noteAttempt === undefined;
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
      {(state.isPending || deletion.isPending) && <Loading label={t('LoadingStudy')} />}
      {deletion.error && (
        <NoteReadError error={deletion.error} retry={() => void deletion.refetch()} />
      )}
      {state.error && <NoteReadError error={state.error} retry={() => void state.refetch()} />}
    </>
  );
}
