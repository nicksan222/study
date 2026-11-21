import { RegistryContext, useAtomValue } from '@effect/atom-react';
import { projectIdSchema } from '@study/contracts';
import type { NoteId } from '@study/contracts';
import { rpc, useIndependentMutation } from '@study/contracts/react';
import {
  Button,
  ComposerSurface,
  Loading,
  Notebook,
  NoteStarter,
  StatusMessage,
  WorkspaceCard,
  WorkspaceSurface,
  WorkspaceDeskSurface as Desk
} from '@study/ui';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Effect, Schema } from 'effect';
import { useContext, useEffect, useId, useRef, useState } from 'react';

import {
  DictationButton,
  DictationSubmissionScope,
  useDictationSubmission,
  useTextDictation
} from '#client/features/voice/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { isNoteSubmit } from './draft';
import { useNoteList } from './note-reads';
import { NoteWindowNavigation } from './note-window-navigation';
import { NotebookHeading } from './notebook-heading';
import {
  startDraftKey,
  startDraft,
  openStartDraft,
  finishStartDraft
} from './start-drafts.queries';
import { creationFlow, startNote } from './start.queries';
import { NoteError, NoteReadError } from './status';
import { usePhoneLayout } from './use-phone-layout';
import { WorkspaceContext } from './workspace-context';
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

/** Creation owns the shared uncertainty fence and transfers only the submitted draft keys. */

function useNoteStart() {
  const cache = useContext(RegistryContext);
  const navigate = useNavigate();
  const search = useSearch({ from: '__root__' });
  const project = search.project
    ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(search.project))
    : undefined;
  const state = useNoteList(project);
  const { draftKey, draft } = useStartDraft(search.project);
  const flow = { data: useAtomValue(creationFlow) };
  const [navigationError, setNavigationError] = useState<unknown>();
  const [reviewed, setReviewed] = useState(false);

  async function select(id: NoteId, scope: string | null = search.project ?? null) {
    cache.set(creationFlow, { id, pending: true });

    try {
      await navigate({
        to: '/notes/$noteId',
        params: { noteId: id },
        search: scope ? { project: scope } : {}
      });
      cache.set(creationFlow, {});
      setNavigationError(undefined);
    } catch (error) {
      cache.set(creationFlow, { id });
      setNavigationError(error);
    }
  }

  const create = useIndependentMutation((input: Parameters<typeof startNote>[0]) =>
    Effect.tryPromise({
      try: async () => {
        setReviewed(false);

        try {
          const created = await startNote(input);

          await select(created.id, input.project ? String(input.project) : null);
          finishStartDraft(cache, input);

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

    if (current.id || current.uncertain || current.pending) return;

    cache.set(creationFlow, { uncertain: true, pending: true });
    const text = cache.get(startDraft(draftKey)) ?? '';

    if (!text.trim()) {
      cache.set(creationFlow, {});

      return;
    }

    void create.mutate({ project, draftKey, text }).catch(() => {});
  }

  const blocked = create.isPending || !!flow.data.id || !!flow.data.uncertain;

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
  const subjects = rpc.projects.list.useQuery({ limit: 100 });
  const owner = subjects.data?.items.find((subject) => String(subject.id) === view.search.project);
  const phone = usePhoneLayout();
  const [cardPreference, setCardVisible] = useState<boolean>();
  const cardVisible = cardPreference ?? !phone;

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
                    <NotebookHeading />
                    <WorkspaceSurface.Heading>
                      <h3>{t('NoteNotesEmpty')}</h3>
                      <p>{t('NoteStartHelp')}</p>
                    </WorkspaceSurface.Heading>
                  </Notebook.History>
                  <CreationRecovery view={view} />
                  <Desk.InlineComposer>
                    <StarterComposer view={view} />
                    <CreationStatus view={view} />
                  </Desk.InlineComposer>
                </Desk.BoardBody>
              </Desk.Board>
              <WorkspaceContext hidden={!cardVisible} onDismiss={() => setCardVisible(false)} />
            </Desk.NotebookLayout>
          </Desk.ScrollArea>
          <Desk.NavigationHost />
        </Desk.Notebook>
      </Desk.Root>
    </WorkspaceSurface.Root>
  );
}

/** The notebook composer submits its first capture before navigating to the saved note. */

function StarterComposer({ view }: { view: StartView }) {
  const { t } = useI18n();
  const noteId = useId();
  const preferences = useWorkspacePreferences();
  const { cache, draftKey, draft, blocked, beginNote } = view;
  const input = useRef<HTMLTextAreaElement>(null);
  const submission = useDictationSubmission();
  const submit = () => {
    if (!blocked && !submission.isBlocked()) beginNote();
  };
  const dictation = useTextDictation({
    value: draft.data,
    onChange: (text) => cache.set(startDraft(draftKey), text),
    input
  });

  return (
    <ComposerSurface.Root variant="notebook" aria-label={t('NoteCompose')}>
      <Notebook.Label htmlFor={noteId}>{t('NoteCompose')}</Notebook.Label>
      <ComposerSurface.Input
        id={noteId}
        ref={input}
        rows={1}
        spellCheck={preferences.spellcheck}
        aria-label={t('NoteCompose')}
        aria-describedby="note-start-hint"
        placeholder={t('NoteComposeHint')}
        value={draft.data}
        onChange={(event) => cache.set(startDraft(draftKey), event.target.value)}
        onKeyDown={(event) => {
          if (isNoteSubmit(event, preferences.submitOnEnter)) {
            event.preventDefault();

            submit();
          }
        }}
      />
      <ComposerSurface.Footer variant="notebook">
        <Notebook.CaptureTools>
          <DictationSubmissionScope value={submission.scope}>
            <DictationButton targetKey={draftKey} {...dictation} disabled={blocked} />
          </DictationSubmissionScope>
        </Notebook.CaptureTools>
        <Notebook.Actions>
          <Button
            size="sm"
            disabled={blocked || submission.blocked || !draft.data.trim()}
            aria-busy={view.flow.data.pending}
            onClick={submit}
          >
            {t('NoteSaveNote')}
          </Button>
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

  if (flow.data.pending)
    return (
      <NoteStarter.Feedback>
        <Loading label={t('NoteStarting')} />
      </NoteStarter.Feedback>
    );

  const id = flow.data.id;

  if (id)
    return (
      <NoteStarter.Feedback>
        {!!navigationError && <NoteError error={navigationError} />}
        <Button variant="outline" onClick={() => void select(id)}>
          {t('NoteOpenCreated')}
        </Button>
      </NoteStarter.Feedback>
    );

  if (!create.error) return null;

  return (
    <NoteStarter.Feedback>
      <NoteError error={create.error} />
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
