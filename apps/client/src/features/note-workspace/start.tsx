import { RegistryContext, useAtomValue } from '@effect/atom-react';
import { projectIdSchema } from '@study/contracts';
import type { NoteId } from '@study/contracts';
import { rpc, useIndependentMutation } from '@study/contracts/react';
import {
  Button,
  Loading,
  NoteStarter,
  StatusMessage,
  WorkspaceSurface,
  WritingSurface,
  WorkspaceDeskSurface as Desk
} from '@study/ui';
import { Link, useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { Effect, Schema } from 'effect';
import { useContext, useEffect, useEffectEvent, useRef, useState } from 'react';

import { DictationSubmissionScope, useDictationSubmission } from '#client/features/voice/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';

import { starterTransfer } from './body-autosave.queries';
import { NoteEditor } from './note-editor';
import { useNoteList } from './note-reads';
import { NoteWindowNavigation } from './note-window-navigation';
import {
  startDraftKey,
  startDraft,
  openStartDraft,
  dismissStartDraft
} from './start-drafts.queries';
import { creationFlow, startNote } from './start.queries';
import { NoteError, NoteReadError } from './status';
import { WorkspaceHeader } from './workspace-header';

/** One unsent starter draft is cached independently for each subject. */

function useStartDraft(project: string | undefined) {
  const draftKey = startDraftKey(project);
  const cache = useContext(RegistryContext);

  useEffect(() => {
    openStartDraft(cache, project);
  }, [cache, project]);
  const draft = { data: useAtomValue(startDraft(draftKey)) };

  return { draftKey, draft };
}

function useStarterNavigation(
  scope: string | undefined,
  submission: ReturnType<typeof useDictationSubmission>
) {
  const cache = useContext(RegistryContext);
  const navigate = useNavigate();
  const router = useRouter();
  const deferred = useRef<{ id: NoteId; scope: string | null } | undefined>(undefined);
  const editor = useRef<HTMLDivElement>(null);
  const [navigationError, setNavigationError] = useState<unknown>();

  async function select(id: NoteId, project = scope ?? null) {
    cache.set(creationFlow, { id, scope: project, pending: true });

    try {
      await navigate({
        to: '/notes/$noteId',
        params: { noteId: id },
        search: project ? { project } : {}
      });
      dismissStartDraft(cache, project ?? undefined);
      cache.set(creationFlow, {});
      setNavigationError(undefined);
    } catch (error) {
      cache.set(creationFlow, { id, scope: project });
      setNavigationError(error);
    }
  }

  const selectDeferred = useEffectEvent(select);

  useEffect(() => {
    if (submission.blocked || !deferred.current) return;

    const pending = deferred.current;

    deferred.current = undefined;

    if (pending.scope === (scope ?? null)) void selectDeferred(pending.id, pending.scope);
  }, [scope, submission.blocked]);

  async function openCreated(id: NoteId, input: Parameters<typeof startNote>[0]) {
    const project = input.project ? String(input.project) : undefined;
    const location = router.state.location;
    const active = /^\/notes\/?$/.test(location.pathname) && location.search.project === project;

    cache.set(starterTransfer(id), {
      submitted: input.text,
      text: cache.get(startDraft(input.draftKey)) ?? input.text,
      focus: active && hasWritingFocus(editor.current)
    });

    if (!active) {
      cache.set(creationFlow, {});
      dismissStartDraft(cache, project);
    } else if (submission.isBlocked()) {
      deferred.current = { id, scope: project ?? null };
      cache.set(creationFlow, { id, scope: project ?? null });
    } else {
      await select(id, project ?? null);
    }
  }

  return { editor, navigationError, openCreated, select };
}

function hasWritingFocus(editor: HTMLDivElement | null) {
  const focused = document.activeElement;

  return !!focused?.matches('[contenteditable="true"]') && !!editor?.contains(focused);
}

/** Keeps one creation attempt in flight and hands subsequent typing to the new note. */
function useNoteStart() {
  const cache = useContext(RegistryContext);
  const search = useSearch({ from: '__root__' });
  const project = search.project
    ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(search.project))
    : undefined;
  const state = useNoteList(project);
  const { draftKey, draft } = useStartDraft(search.project);
  const flow = { data: useAtomValue(creationFlow) };
  const [reviewed, setReviewed] = useState(false);
  const submission = useDictationSubmission();
  const { editor, navigationError, openCreated, select } = useStarterNavigation(
    search.project,
    submission
  );

  const create = useIndependentMutation((input: Parameters<typeof startNote>[0]) =>
    Effect.tryPromise({
      try: async () => {
        setReviewed(false);

        try {
          const created = await startNote(input);

          await openCreated(created.id, input);

          return created;
        } catch (error) {
          if (toStudyError(error).kind === 'invalid_input') cache.set(creationFlow, {});

          throw error;
        } finally {
          cache.update(creationFlow, (previous) => ({ ...previous, pending: false }));
        }
      },
      catch: toStudyError
    })
  );

  function beginNote() {
    const current = cache.get(creationFlow) ?? {};

    if (current.id || current.uncertain || current.pending || submission.isBlocked()) return;

    cache.set(creationFlow, { uncertain: true, pending: true });
    const text = cache.get(startDraft(draftKey)) ?? '';

    if (!text.trim()) {
      cache.set(creationFlow, {});

      return;
    }

    void create.mutate({ project, draftKey, text }).catch(() => {});
  }

  const blocked = !!flow.data.id || !!flow.data.uncertain || !!create.error;
  const onIdle = useEffectEvent(beginNote);

  useEffect(() => {
    if (!draft.data.trim() || blocked || submission.blocked) return;

    const timer = window.setTimeout(onIdle, 650);

    return () => window.clearTimeout(timer);
  }, [draft.data, draftKey, blocked, submission.blocked]);

  return {
    cache,
    search,
    state,
    draftKey,
    draft,
    flow,
    navigationError,
    reviewed,
    setReviewed,
    create,
    editor,
    submission,
    select
  };
}

type StartView = ReturnType<typeof useNoteStart>;

/** Uses the regular notebook shell while its first capture remains a local draft. */

export function NoteStart() {
  const { t } = useI18n();
  const view = useNoteStart();
  const { state, flow } = view;
  const subjects = rpc.projects.list.useQuery({ limit: 100 });
  const owner = subjects.data?.items.find((subject) => String(subject.id) === view.search.project);

  if (state.isError && !flow.data.uncertain && !flow.data.id) {
    return <NoteReadError error={state.error} retry={() => void state.refetch()} layout="page" />;
  }

  return (
    <WorkspaceSurface.Root variant="desk">
      <WorkspaceHeader owner={owner} title={t('NewNote')} />
      <Desk.Root open={false} expanded={false}>
        <Desk.Notebook>
          <Desk.ScrollArea>
            <Desk.NotebookLayout>
              <Desk.Board>
                <Desk.BoardBody>
                  <WritingSurface
                    ref={view.editor}
                    heading={<h1>{t('NewNote')}</h1>}
                    status={flow.data.pending ? t('NoteAutosaving') : undefined}
                  >
                    <CreationRecovery view={view} />
                    <CreationStatus view={view} />
                    <DictationSubmissionScope value={view.submission.scope}>
                      <NoteEditor
                        key={view.draftKey}
                        targetKey={view.draftKey}
                        label={t('NoteCompose')}
                        value={view.draft.data}
                        disabled={!!flow.data.id && flow.data.pending}
                        onChange={(text) => {
                          view.cache.set(startDraft(view.draftKey), text);
                          const { id, scope } = flow.data;

                          if (id && scope === (view.search.project ?? null))
                            view.cache.update(
                              starterTransfer(id),
                              (pending) => pending && { ...pending, text }
                            );
                        }}
                        variant="writing"
                      />
                    </DictationSubmissionScope>
                  </WritingSurface>
                </Desk.BoardBody>
              </Desk.Board>
            </Desk.NotebookLayout>
          </Desk.ScrollArea>
          <Desk.NavigationHost />
        </Desk.Notebook>
      </Desk.Root>
    </WorkspaceSurface.Root>
  );
}

/** Navigation failures retain the known created note for a safe retry. */

function CreationStatus({ view }: { view: StartView }) {
  const { t } = useI18n();
  const { flow, select, navigationError, create } = view;

  if (flow.data.pending || view.submission.blocked) return null;

  const id = flow.data.id;

  if (id)
    return (
      <NoteStarter.Feedback>
        {!!navigationError && <NoteError error={navigationError} />}
        <Button variant="outline" onClick={() => void select(id, flow.data.scope)}>
          {t('NoteOpenCreated')}
        </Button>
      </NoteStarter.Feedback>
    );

  if (!create.error) return null;

  return (
    <NoteStarter.Feedback>
      <NoteError error={create.error} />
      {!flow.data.uncertain && (
        <Button variant="outline" onClick={() => create.reset()}>
          {t('NoteRetrySave')}
        </Button>
      )}
    </NoteStarter.Feedback>
  );
}

/** An uncertain creation can be cleared only after a successful note-list review. */

function CreationRecovery({ view }: { view: StartView }) {
  const { t } = useI18n();
  const { flow, state, reviewed, setReviewed, cache, create } = view;

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
                try {
                  await rpc.notes.list.read({
                    project: view.search.project
                      ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(view.search.project))
                      : undefined,
                    limit: 30
                  });
                  state.refetch();
                  setReviewed(true);
                } catch {
                  setReviewed(false);
                }
              }}
            >
              {t('LibraryRefresh')}
            </Button>
            {reviewed && (
              <Button
                onClick={() => {
                  cache.set(creationFlow, {});
                  create.reset();
                  setReviewed(false);
                }}
              >
                {t('NoteCreationReviewed')}
              </Button>
            )}
          </NoteStarter.Actions>

          <CreationReviewList view={view} />
          <NoteWindowNavigation state={state} />
        </NoteStarter.Recovery>
      )}
    </>
  );
}

function CreationReviewList({ view }: { view: StartView }) {
  const { t, date } = useI18n();
  const { state, search } = view;
  const items = state.data?.items ?? [];

  return (
    <>
      {' '}
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
    </>
  );
}
