import { StudyError } from '@study/contracts/errors';
import type { ProjectId } from '@study/contracts/ids';
import type { Project } from '@study/contracts/projects/schemas';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Input } from '@study/ui/input';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { request } from '../../lib/study-client/request';
import { materialsOptions } from '../material-library/material-library.queries';
import { sessionPagesOptions } from '../session-workspace/session-workspace.queries';
import { useCollectionState, validCollectionName } from './collection-state';

export function CollectionsPage() {
  const { t } = useI18n();
  const client = useQueryClient();
  const { state: draft, update, mutate } = useCollectionState();
  const name = draft.name.text;
  const busy = draft.pending;
  const list = useInfiniteQuery({
    queryKey: ['projects', 'collections', 'pages'],
    initialPageParam: undefined as ProjectId | undefined,
    queryFn: ({ pageParam, signal }) =>
      request((c) => c['projects.projects']({ limit: 20, before: pageParam }), signal),
    getNextPageParam: (page) => page.next ?? undefined
  });
  const selected = useQuery({
    queryKey: ['projects', 'collection', String(draft.selected)],
    enabled: draft.selected !== null,
    queryFn: ({ signal }) => request((c) => c['projects.project']({ id: draft.selected! }), signal)
  });
  useEffect(() => {
    if (selected.isError && toStudyError(selected.error).kind === 'not_found') {
      update((value) => (value.accepted === draft.selected ? { ...value, accepted: null } : value));
    }
  }, [selected.isError, selected.error, draft.selected]);
  return (
    <div className="grid w-full min-w-0 grid-cols-1 items-start gap-4 p-4 text-sm md:p-6 xl:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <form
          className="flex flex-wrap items-end gap-3 border-b border-border pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!validCollectionName(name) || draft.uncertain || busy) return;
            const submitted = draft.name;
            void mutate(async () => {
              update((value) => ({ ...value, uncertain: true }));
              try {
                const created = await request((c) =>
                  c['projects.createProject']({ name: submitted.text.trim() })
                );
                client.setQueryData(['projects', 'collection', String(created.id)], created);
                update((value) => ({
                  ...value,
                  accepted: created.id,
                  selected: created.id,
                  uncertain: false,
                  name:
                    value.name.revision === submitted.revision
                      ? { text: '', revision: value.name.revision + 1 }
                      : value.name
                }));
              } catch (error) {
                if (toStudyError(error).kind === 'invalid_input')
                  update((value) => ({ ...value, uncertain: false }));
                throw error;
              }
            });
          }}
        >
          <label className="flex min-w-48 flex-1 flex-col gap-2">
            {t('collections.name')}
            <Input
              value={name}
              onChange={(e) => {
                const text = e.target.value;
                update((value) => ({
                  ...value,
                  name: { text, revision: value.name.revision + 1 }
                }));
              }}
            />
          </label>
          <Button type="submit" disabled={busy || draft.uncertain || !validCollectionName(name)}>
            {t('collections.create')}
          </Button>
        </form>
        {draft.uncertain && busy ? <p role="status">{t('collections.creating')}</p> : null}
        {draft.uncertain && !busy ? (
          <ErrorState
            title={t('ErrorStateTitle')}
            description={
              <>
                <p>{t('collections.uncertain')}</p>
                <Button
                  disabled={busy || list.isFetching || !draft.reviewed}
                  onClick={() => {
                    if (!draft.pending)
                      update((value) =>
                        value.pending ? value : { ...value, uncertain: false, reviewed: false }
                      );
                  }}
                >
                  {t('collections.reviewed')}
                </Button>
              </>
            }
          />
        ) : null}
        {draft.accepted ? <p role="status">{t('collections.created')}</p> : null}
        {draft.error ? (
          <ErrorState
            title={t('ErrorStateTitle')}
            description={
              <>
                {t(
                  draft.error === 'invalid_input'
                    ? 'collections.invalidName'
                    : draft.error === 'not_found'
                      ? 'collections.missing'
                      : 'collections.mutationError'
                )}
              </>
            }
          />
        ) : null}
        <p className="text-sm text-muted-foreground">{t('collections.nameLimit')}</p>
        <ReadState
          pending={list.isPending}
          emptyMessage={t('collections.emptyCatalog')}
          error={list.isError}
          empty={list.data?.pages.every((p) => p.items.length === 0) ?? false}
          retry={() => void list.refetch()}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={list.isFetching || busy}
          onClick={async () => {
            const result = await list.refetch();
            if (draft.selected !== null) await selected.refetch();
            update((value) => ({ ...value, reviewed: !result.isError && !value.pending }));
          }}
        >
          {t('collections.retry')}
        </Button>
        <ul className="divide-y divide-border">
          {list.data?.pages
            .flatMap((p) => p.items)
            .map((project) => (
              <li
                key={String(project.id)}
                className="flex min-w-0 items-center justify-between gap-3 py-1"
              >
                <Button
                  variant="ghost"
                  className="min-w-0 flex-1 justify-start truncate aria-pressed:bg-muted"
                  onClick={() => update((value) => ({ ...value, selected: project.id }))}
                  aria-pressed={draft.selected === project.id}
                >
                  {project.name}
                </Button>
                <span className="text-sm text-muted-foreground">{project.examOn}</span>
              </li>
            ))}
        </ul>
        {list.hasNextPage ? (
          <Button disabled={list.isFetching} onClick={() => void list.fetchNextPage()}>
            {t('collections.more')}
          </Button>
        ) : null}
      </div>
      <div className="min-w-0 xl:border-l xl:border-border xl:pl-6">
        {draft.selected !== null && (
          <>
            {selected.isPending && <p role="status">{t('collections.loading')}</p>}
            {selected.isError && (
              <ErrorState
                title={t('ErrorStateTitle')}
                description={
                  <>
                    <p>
                      {t(
                        toStudyError(selected.error).kind === 'not_found'
                          ? 'collections.missing'
                          : 'collections.readError'
                      )}
                    </p>
                    <Button onClick={() => void selected.refetch()}>
                      {t('collections.retry')}
                    </Button>
                  </>
                }
              />
            )}
            {selected.data && !selected.isError && (
              <Collection
                key={String(selected.data.id)}
                project={selected.data}
                busy={busy}
                mutate={mutate}
                close={(id) =>
                  update((value) => ({
                    ...value,
                    selected: value.selected === id ? null : value.selected,
                    accepted: value.accepted === id ? null : value.accepted
                  }))
                }
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ReadState({
  pending,
  error,
  empty,
  emptyMessage,
  retry
}: {
  pending: boolean;
  error: boolean;
  empty: boolean;
  emptyMessage: string;
  retry: () => void;
}) {
  const { t } = useI18n();
  return pending ? (
    <p role="status">{t('collections.loading')}</p>
  ) : error ? (
    <ErrorState
      title={t('ErrorStateTitle')}
      description={
        <>
          <p>{t('collections.readError')}</p>
          <Button onClick={retry}>{t('collections.retry')}</Button>
        </>
      }
    />
  ) : empty ? (
    <p className="text-sm text-muted-foreground">{emptyMessage}</p>
  ) : null;
}

function Collection({
  project,
  busy,
  mutate,
  close
}: {
  project: Project;
  busy: boolean;
  mutate: (action: () => Promise<unknown>) => Promise<void>;
  close: (id: ProjectId) => void;
}) {
  const { t } = useI18n();
  const { state, update } = useCollectionState();
  const entry = state.names[String(project.id)];
  const name = entry?.text ?? project.name;
  const [deleting, setDeleting] = useState(false);
  const [confirmation, confirm] = useState('');
  return (
    <section
      className="min-w-0 space-y-5 border-t border-border pt-5 xl:border-t-0 xl:pt-0"
      aria-label={project.name}
    >
      <h2 className="text-lg font-semibold">{project.name}</h2>
      <div className="flex gap-4">
        <Link className="underline" to="/library" search={{ project: String(project.id) }}>
          {t('collections.library')}
        </Link>
        <Link className="underline" to="/sessions" search={{ project: String(project.id) }}>
          {t('collections.sessions')}
        </Link>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (validCollectionName(name))
            void mutate(async () => {
              const changed = await request((c) =>
                c['projects.renameProject']({ id: project.id, name: name.trim() })
              );
              if (!changed) throw new StudyError('not_found', 'Collection no longer exists');
              update((value) => {
                if (value.names[String(project.id)]?.revision !== entry?.revision) return value;
                const names = { ...value.names };
                delete names[String(project.id)];
                return { ...value, names };
              });
            });
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-2">
          {t('collections.name')}
          <Input
            value={name}
            onChange={(e) => {
              const text = e.target.value;
              update((value) => ({
                ...value,
                names: {
                  ...value.names,
                  [String(project.id)]: {
                    text,
                    revision: (value.names[String(project.id)]?.revision ?? 0) + 1
                  }
                }
              }));
            }}
          />
        </label>
        <Button
          type="submit"
          disabled={busy || name === project.name || !validCollectionName(name)}
        >
          {t('collections.rename')}
        </Button>
      </form>
      <Members project={project.id} kind="materials" busy={busy} mutate={mutate} />
      <Members project={project.id} kind="sessions" busy={busy} mutate={mutate} />
      <Button variant="destructive-outline" disabled={busy} onClick={() => setDeleting(true)}>
        {t('collections.delete')}
      </Button>
      {deleting ? (
        <div className="space-y-3" role="group" aria-label={t('collections.delete')}>
          <p>{t('collections.deleteHelp')}</p>
          <label>
            {t('collections.confirmName')}
            <Input autoFocus value={confirmation} onChange={(e) => confirm(e.target.value)} />
          </label>
          <div className="flex gap-3">
            <Button
              variant="destructive"
              disabled={busy || confirmation !== project.name}
              onClick={() =>
                void mutate(async () => {
                  await request((c) => c['projects.deleteProject']({ id: project.id }));
                  close(project.id);
                })
              }
            >
              {t('collections.delete')}
            </Button>
            <Button disabled={busy} onClick={() => setDeleting(false)}>
              {t('collections.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Members({
  project,
  kind,
  busy,
  mutate
}: {
  project: ProjectId;
  kind: 'materials' | 'sessions';
  busy: boolean;
  mutate: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [picker, setPicker] = useState(false);
  const materials = useInfiniteQuery({
    ...materialsOptions(picker ? undefined : project),
    enabled: kind === 'materials'
  });
  const sessions = useInfiniteQuery({
    ...sessionPagesOptions(picker ? undefined : project),
    enabled: kind === 'sessions'
  });
  const state = kind === 'materials' ? materials : sessions;
  return (
    <section className="space-y-3">
      <h3 className="font-medium">
        {t(kind === 'materials' ? 'collections.library' : 'collections.sessions')}
      </h3>
      <p className="text-sm text-muted-foreground">{t('collections.detachHelp')}</p>
      <Button aria-pressed={picker} onClick={() => setPicker(!picker)}>
        {t(picker ? 'collections.members' : 'collections.picker')}
      </Button>
      <ReadState
        pending={state.isPending}
        emptyMessage={t(picker ? 'collections.emptyPicker' : 'collections.emptyMembers')}
        error={state.isError}
        empty={state.data?.pages.every((p) => p.items.length === 0) ?? false}
        retry={() => void state.refetch()}
      />
      <Button disabled={state.isFetching || busy} onClick={() => void state.refetch()}>
        {t('collections.retry')}
      </Button>
      <ul className="divide-y divide-border">
        {kind === 'materials'
          ? materials.data?.pages
              .flatMap((p) => p.items)
              .map((item) => (
                <li key={String(item.id)} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{item.title}</span>
                  <Button
                    className="shrink-0"
                    aria-label={`${t(picker ? 'collections.add' : 'collections.detach')}: ${item.title}`}
                    disabled={busy || (picker && item.projectIds.includes(project))}
                    onClick={() =>
                      void mutate(() =>
                        request((c) =>
                          picker
                            ? c['projects.addMaterial']({ projectId: project, materialId: item.id })
                            : c['projects.removeMaterial']({
                                projectId: project,
                                materialId: item.id
                              })
                        )
                      )
                    }
                  >
                    {t(picker ? 'collections.add' : 'collections.detach')}
                  </Button>
                </li>
              ))
          : sessions.data?.pages
              .flatMap((p) => p.items)
              .map((item) => (
                <li key={String(item.id)} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{item.title}</span>
                  <Button
                    className="shrink-0"
                    aria-label={`${t(picker ? 'collections.add' : 'collections.detach')}: ${item.title}`}
                    disabled={busy || (picker && item.projectIds.includes(project))}
                    onClick={() =>
                      void mutate(() =>
                        request((c) =>
                          picker
                            ? c['projects.addSession']({ projectId: project, sessionId: item.id })
                            : c['projects.removeSession']({
                                projectId: project,
                                sessionId: item.id
                              })
                        )
                      )
                    }
                  >
                    {t(picker ? 'collections.add' : 'collections.detach')}
                  </Button>
                </li>
              ))}
      </ul>
      {state.hasNextPage ? (
        <Button disabled={state.isFetching} onClick={() => void state.fetchNextPage()}>
          {t('collections.more')}
        </Button>
      ) : null}
    </section>
  );
}
