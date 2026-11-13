import { projectIdSchema } from '@study/contracts/ids';
import type { NoteId } from '@study/contracts/ids';
import { LoadMoreButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { ComposerSurface } from '@study/ui/composer';
import { IconButton } from '@study/ui/icon-button';
import { Loading } from '@study/ui/loading';
import { NoteStarter } from '@study/ui/note-start';
import { Notebook } from '@study/ui/note-workspace';
import { StatusMessage } from '@study/ui/status-message';
import { WorkspaceCard, WorkspaceSurface } from '@study/ui/workspace';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { ArrowUp, Paperclip, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';
import type { Notes } from '#client/lib/study-client/operations.ts';
import { projectsQueryOptions } from '#client/lib/study-client/study.queries.ts';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { isNoteSubmit } from './draft';
import { noteKey, paginatedNotesOptions } from './note-workspace.queries';
import { startDraftKey, openStartDraft, finishStartDraft } from './start-drafts.queries';
import {
  startDraftOptions,
  startFilesOptions,
  creationFlowOptions,
  startNoteMutation
} from './start.queries';
import type { CreationFlow } from './start.queries';
import { NoteError, NoteReadError } from './status';
import { WorkspaceContext } from './workspace-context';
import { WorkspaceHeader } from './workspace-header';

/** One unsent starter draft is cached independently for each subject. */

function useStartDraft(project: string | undefined) {
  const draftKey = startDraftKey(project);
  const cache = useQueryClient();

  useEffect(() => {
    openStartDraft(cache, project);
  }, [cache, project]);
  const draft = useQuery(startDraftOptions(draftKey));
  const filesKey = [...draftKey, 'files'];
  const files = useQuery(startFilesOptions(filesKey));

  return { draftKey, draft, filesKey, files };
}

/** Creation owns the shared uncertainty fence and transfers only the submitted draft keys. */

function useNoteStart() {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ from: '__root__' });
  const project = search.project
    ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(search.project))
    : undefined;
  const state = useInfiniteQuery(paginatedNotesOptions(project));
  const { draftKey, draft, filesKey, files } = useStartDraft(search.project);
  const flow = useQuery(creationFlowOptions());
  const [navigationError, setNavigationError] = useState<unknown>();
  const [reviewed, setReviewed] = useState(false);

  async function select(id: NoteId, scope: string | null = search.project ?? null) {
    try {
      await navigate({
        to: '/notes/$noteId',
        params: { noteId: id },
        search: scope ? { project: scope } : {}
      });
      cache.setQueryData(['note-workspace', 'creation'], {});
      setNavigationError(undefined);
    } catch (error) {
      setNavigationError(error);
    }
  }

  const create = useMutation({
    ...startNoteMutation,
    onMutate: () => {
      cache.setQueryData(['note-workspace', 'creation'], { uncertain: true, pending: true });
      setReviewed(false);
    },
    onError: (error) => {
      if (toStudyError(error).kind === 'invalid_input')
        cache.setQueryData(['note-workspace', 'creation'], {});
    },
    onSettled: () => {
      cache.setQueryData<CreationFlow>(['note-workspace', 'creation'], (previous) => ({
        ...previous,
        pending: false
      }));
    },
    onSuccess: async (created, input) => {
      await cache.cancelQueries({ queryKey: ['notes'] });
      cache.setQueryData<Notes>(['notes'], (items) => [
        created,
        ...(items ?? []).filter((note) => note.id !== created.id)
      ]);
      finishStartDraft(cache, input);
      cache.setQueryData(['note-workspace', 'creation'], { id: created.id });
      void cache.invalidateQueries({ queryKey: ['notes'] });
      void cache.invalidateQueries({ queryKey: noteKey(created.id) });
      void select(created.id, input.project ? String(input.project) : null);
    }
  });

  function beginNote() {
    const current = cache.getQueryData<CreationFlow>(['note-workspace', 'creation']) ?? {};

    if (current.id || current.uncertain || current.pending) return;

    cache.setQueryData(['note-workspace', 'creation'], { uncertain: true, pending: true });
    const text = cache.getQueryData<string>(draftKey) ?? '';
    const selectedFiles = cache.getQueryData<File[]>(filesKey) ?? [];

    if (!text.trim() && !selectedFiles.length) {
      cache.setQueryData(['note-workspace', 'creation'], {});

      return;
    }

    create.mutate({ project, draftKey, filesKey, text, files: selectedFiles });
  }

  const blocked = create.isPending || !!flow.data.id || !!flow.data.uncertain;

  return {
    cache,
    search,
    state,
    draftKey,
    draft,
    filesKey,
    files,
    flow,
    navigationError,
    reviewed,
    setReviewed,
    create,
    beginNote,
    select,
    blocked
  };
}

type StartView = ReturnType<typeof useNoteStart>;

/** Uses the regular notebook shell while its first capture remains a local draft. */

export function NoteStart() {
  const { t } = useI18n();
  const view = useNoteStart();
  const { state, flow } = view;
  const subjects = useQuery(projectsQueryOptions());
  const owner = subjects.data?.find((subject) => String(subject.id) === view.search.project);
  const [cardVisible, setCardVisible] = useState(true);

  if (state.isError && !flow.data.uncertain && !flow.data.id) {
    return <NoteReadError error={state.error} retry={() => void state.refetch()} layout="page" />;
  }

  return (
    <WorkspaceSurface.Root variant="desk">
      <WorkspaceHeader owner={owner} title={t('NewNote')}>
        <Desk.LayoutControls aria-label={t('NoteLayout')}>
          <WorkspaceCard.Toggle
            label={t('NoteActions')}
            open={cardVisible}
            onOpenChange={setCardVisible}
          />
        </Desk.LayoutControls>
      </WorkspaceHeader>
      <Desk.Root open={false} expanded={false} cardOpen={cardVisible}>
        <Desk.Notebook>
          <Desk.ScrollArea>
            <Desk.NotebookLayout>
              <Desk.Board>
                <Desk.BoardBody>
                  <Notebook.History aria-label={t('NoteNotebook')}>
                    <Notebook.NotesHeading>
                      <Notebook.PageHeading>
                        <h1>{t('NoteNotesTitle')}</h1>
                        <p>{t('NoteNotesHelp')}</p>
                      </Notebook.PageHeading>
                    </Notebook.NotesHeading>
                    <WorkspaceSurface.Heading>
                      <h3>{t('NoteNotesEmpty')}</h3>
                      <p>{t('NoteStartHelp')}</p>
                    </WorkspaceSurface.Heading>
                  </Notebook.History>
                  <CreationStatus view={view} />
                  <CreationRecovery view={view} />
                </Desk.BoardBody>
              </Desk.Board>
              <WorkspaceContext hidden={!cardVisible} onDismiss={() => setCardVisible(false)} />
            </Desk.NotebookLayout>
          </Desk.ScrollArea>
          <Desk.NavigationHost />
          <Desk.FloatingComposer>
            <WorkspaceSurface.Dock>
              <StarterComposer view={view} />
            </WorkspaceSurface.Dock>
          </Desk.FloatingComposer>
        </Desk.Notebook>
      </Desk.Root>
    </WorkspaceSurface.Root>
  );
}

const attachmentIds = new WeakMap<File, string>();

/** File identity survives removals; occurrence suffixes also support repeated File references. */

function attachmentEntries(files: File[]) {
  const occurrences = new Map<string, number>();

  return files.map((file, index) => {
    let id = attachmentIds.get(file);

    if (!id) {
      id = crypto.randomUUID();
      attachmentIds.set(file, id);
    }

    const occurrence = occurrences.get(id) ?? 0;

    occurrences.set(id, occurrence + 1);

    return { file, index, key: `${id}:${occurrence}` };
  });
}

/** The notebook composer submits its first capture before navigating to the saved note. */

function StarterComposer({ view }: { view: StartView }) {
  const { t } = useI18n();
  const attachmentId = useId();
  const noteId = useId();
  const preferences = useWorkspacePreferences();
  const { cache, filesKey, files, draftKey, draft, blocked, beginNote } = view;

  return (
    <ComposerSurface.Root
      variant="notebook"
      aria-label={t('NoteCompose')}
      onDragOver={(event) => {
        if (!blocked) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();

        if (!blocked) {
          const added = Array.from(event.dataTransfer.files);

          cache.setQueryData<File[]>(filesKey, (previous) => [...(previous ?? []), ...added]);
        }
      }}
    >
      {files.data.length > 0 && (
        <NoteStarter.Files>
          {attachmentEntries(files.data).map(({ file, index, key }) => (
            <li key={key}>
              <Paperclip size={14} aria-hidden="true" />
              <span>{file.name}</span>
              <IconButton
                size="icon-sm"
                variant="ghost-muted"
                label={t('NoteRemoveAttachment')}
                disabled={blocked}
                onClick={() =>
                  cache.setQueryData(
                    filesKey,
                    files.data.filter((_, i) => i !== index)
                  )
                }
              >
                <X size={14} aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </NoteStarter.Files>
      )}
      <Notebook.Label htmlFor={noteId}>{t('NoteCompose')}</Notebook.Label>
      <ComposerSurface.Input
        id={noteId}
        rows={1}
        spellCheck={preferences.spellcheck}
        aria-label={t('NoteCompose')}
        aria-describedby="note-start-hint"
        placeholder={t('NoteComposeHint')}
        value={draft.data}
        onChange={(event) => cache.setQueryData(draftKey, event.target.value)}
        onKeyDown={(event) => {
          if (isNoteSubmit(event, preferences.submitOnEnter)) {
            event.preventDefault();

            if (!blocked) beginNote();
          }
        }}
      />
      <ComposerSurface.Footer variant="notebook">
        <Notebook.CaptureTools>
          <Notebook.FileButton title={t('NoteAttachFiles')}>
            <Paperclip size={16} aria-hidden="true" />
            <span>{t('NoteAttach')}</span>
            <input
              id={attachmentId}
              type="file"
              aria-label={t('NoteAttachFiles')}
              multiple
              disabled={blocked}
              onChange={(event) => {
                const added = Array.from(event.target.files ?? []);

                cache.setQueryData<File[]>(filesKey, (previous) => [...(previous ?? []), ...added]);
                event.target.value = '';
              }}
            />
          </Notebook.FileButton>
        </Notebook.CaptureTools>
        <Notebook.Actions>
          <WorkspaceSurface.ComposerSubmit
            aria-label={t('NoteSaveNote')}
            title={t('NoteSaveNote')}
            disabled={blocked || (!draft.data.trim() && files.data.length === 0)}
            aria-busy={view.flow.data.pending}
            onClick={beginNote}
          >
            <ArrowUp size={18} aria-hidden="true" />
          </WorkspaceSurface.ComposerSubmit>
        </Notebook.Actions>
      </ComposerSurface.Footer>
      <WorkspaceSurface.ComposerHint id="note-start-hint">
        {t('NoteNotebookHint')}
      </WorkspaceSurface.ComposerHint>
    </ComposerSurface.Root>
  );
}

/** Navigation failures retain the known created note for a safe retry. */

function CreationStatus({ view }: { view: StartView }) {
  const { t } = useI18n();
  const { flow, select, navigationError, create } = view;

  return (
    <>
      {flow.data.pending && <Loading label={t('NoteStarting')} />}
      {flow.data.id && (
        <Button variant="outline" onClick={() => void select(flow.data.id!)}>
          {t('NoteOpenCreated')}
        </Button>
      )}
      {!!navigationError && (
        <NoteError
          error={navigationError}
          retry={flow.data.id ? () => void select(flow.data.id!) : undefined}
        />
      )}
      {create.error && <NoteError error={create.error} />}
    </>
  );
}

/** An uncertain creation can be cleared only after a successful note-list review. */

function CreationRecovery({ view }: { view: StartView }) {
  const { t, date } = useI18n();
  const { flow, state, reviewed, setReviewed, cache, create, search } = view;
  const items = state.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      {flow.data.uncertain && !flow.data.pending && (
        <NoteStarter.Recovery aria-label={t('NoteRecent')}>
          <StatusMessage>{t('NoteCreationUncertain')}</StatusMessage>
          <NoteStarter.Actions>
            <Button
              variant="outline"
              disabled={state.isFetching}
              onClick={async () => {
                const result = await state.refetch();

                setReviewed(!result.isError);
              }}
            >
              {t('LibraryRefresh')}
            </Button>
            {reviewed && (
              <Button
                onClick={() => {
                  cache.setQueryData(['note-workspace', 'creation'], {});
                  create.reset();
                  setReviewed(false);
                }}
              >
                {t('NoteCreationReviewed')}
              </Button>
            )}
          </NoteStarter.Actions>

          {state.isPending && <Loading label={t('LoadingStudy')} />}
          {state.error && <NoteReadError error={state.error} retry={() => void state.refetch()} />}
          {state.isSuccess && items.length === 0 && <p>{t('NoteListEmpty')}</p>}
          <NoteStarter.Notes>
            {items.map((item) => (
              <li key={String(item.id)}>
                <Link
                  to="/notes/$noteId"
                  params={{ noteId: item.id }}
                  search={search.project ? { project: search.project } : {}}
                >
                  <span>{item.title || t('NoteUntitled')}</span>
                  <time>{date(item.updatedAt)}</time>
                </Link>
              </li>
            ))}
          </NoteStarter.Notes>
          {state.hasNextPage && (
            <LoadMoreButton
              variant="ghost"
              disabled={state.isFetchingNextPage}
              onClick={() => void state.fetchNextPage()}
              label={t('LibraryMore')}
            />
          )}
        </NoteStarter.Recovery>
      )}
    </>
  );
}
