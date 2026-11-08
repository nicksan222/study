import type { ErrorKind } from '@study/contracts/errors';
import { StudyError } from '@study/contracts/errors';
import type { ProjectId } from '@study/contracts/ids';
import type { Project } from '@study/contracts/projects/schemas';
import { Button } from '@study/ui/button';
import { CollectionPanel } from '@study/ui/collection-panel';
import { DangerDialog } from '@study/ui/danger-dialog';
import { ErrorState } from '@study/ui/error-state';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { StatusMessage } from '@study/ui/status-message';
import { toastManager } from '@study/ui/toast';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { toStudyError } from '#web/lib/study-client/errors.ts';
import { request } from '#web/lib/study-client/request.ts';

import { materialsOptions } from '../material-library';
import { paginatedNotesOptions } from '../note-workspace';
import { SubjectIconEditor, SubjectIdentity } from '../subjects';
import { useCollectionState, validCollectionName } from './collection-state';
import { materialMembership, noteMembership } from './collections.queries';
import { useCollectionsView } from './collections.queries';

type CollectionsView = ReturnType<typeof useCollectionsView>;

export function CollectionsPage() {
  const view = useCollectionsView();

  return (
    <CollectionPanel.Root>
      <CollectionPanel.Catalog>
        <CreateCollection view={view} />
        <CollectionCatalog view={view} />
      </CollectionPanel.Catalog>
      <CollectionPanel.Detail>
        <SelectedCollection view={view} />
      </CollectionPanel.Detail>
    </CollectionPanel.Root>
  );
}

/** Renders collection loading and read failures before exposing collection content. */
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
    <Loading label={t('collections.loading')} />
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
    <CollectionPanel.Muted>{emptyMessage}</CollectionPanel.Muted>
  ) : null;
}

/** Uses shared subject drafts while keeping material and note memberships independently editable. */
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
  const { state, changeName, acceptName } = useCollectionState();
  const entry = state.names[String(project.id)];
  const name = entry?.text ?? project.name;
  const [deleting, setDeleting] = useState(false);

  return (
    <CollectionPanel.Collection aria-label={project.name}>
      <CollectionPanel.IdentityHeader>
        <SubjectIdentity name={project.name} icon={project.icon} size="large" />
        <CollectionPanel.Title>{project.name}</CollectionPanel.Title>
        <SubjectIconEditor project={project} disabled={busy} />
      </CollectionPanel.IdentityHeader>
      <CollectionPanel.Navigation>
        <Link to="/notes" search={{ project: String(project.id) }}>
          <CollectionPanel.LinkText>{t('collections.notes')}</CollectionPanel.LinkText>
        </Link>
      </CollectionPanel.Navigation>
      <CollectionPanel.RenameForm
        onSubmit={(e) => {
          e.preventDefault();

          if (validCollectionName(name))
            void mutate(async () => {
              const changed = await request((c) =>
                c['projects.renameProject']({ id: project.id, name: name.trim() })
              );

              if (!changed) throw new StudyError('not_found', 'Collection no longer exists');

              acceptName(project.id, entry?.revision);
            });
        }}
      >
        <CollectionPanel.NameField>
          {t('collections.name')}
          <Input
            value={name}
            onChange={(e) => {
              changeName(project.id, e.target.value);
            }}
          />
        </CollectionPanel.NameField>
        <Button
          type="submit"
          disabled={busy || name === project.name || !validCollectionName(name)}
        >
          {t('collections.rename')}
        </Button>
      </CollectionPanel.RenameForm>
      <Members project={project.id} kind="materials" busy={busy} mutate={mutate} />
      <Members project={project.id} kind="notes" busy={busy} mutate={mutate} />
      <Button variant="destructive-outline" disabled={busy} onClick={() => setDeleting(true)}>
        {t('collections.delete')}
      </Button>
      <DangerDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('collections.delete')}
        confirmation={{
          value: project.name,
          label: `${t('collections.confirmName')}: ${project.name}`,
          identity: String(project.id)
        }}
        description={t('collections.deleteHelp')}
        confirmLabel={t('collections.delete')}
        cancelLabel={t('collections.cancel')}
        pending={busy}
        onConfirm={() => {
          if (busy) return;

          return mutate(async () => {
            const deleted = await request((c) => c['projects.deleteProject']({ id: project.id }));

            if (!deleted) throw new StudyError('not_found', 'Subject no longer exists');

            toastManager.add({ title: t('SubjectDeleted'), type: 'success' });
            close(project.id);
          });
        }}
      >
        {state.error && <ErrorState layout="inline" title={t('collections.mutationError')} />}
      </DangerDialog>
    </CollectionPanel.Collection>
  );
}

function Members({
  project,
  kind,
  busy,
  mutate
}: {
  project: ProjectId;
  kind: 'materials' | 'notes';
  busy: boolean;
  mutate: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [picker, setPicker] = useState(false);
  const materials = useInfiniteQuery({
    ...materialsOptions(picker ? undefined : project),
    enabled: kind === 'materials'
  });
  const notes = useInfiniteQuery({
    ...paginatedNotesOptions(picker ? undefined : project),
    enabled: kind === 'notes'
  });
  const state = kind === 'materials' ? materials : notes;
  const members =
    kind === 'materials'
      ? materials.data?.pages
          .flatMap((page) => page.items)
          .map((item) => ({ ...item, action: () => materialMembership(project, item.id, picker) }))
      : notes.data?.pages
          .flatMap((page) => page.items)
          .map((item) => ({ ...item, action: () => noteMembership(project, item.id, picker) }));

  return (
    <CollectionPanel.Members>
      <CollectionPanel.MemberHeading>
        {t(kind === 'materials' ? 'collections.library' : 'collections.notes')}
      </CollectionPanel.MemberHeading>
      <CollectionPanel.Muted>{t('collections.detachHelp')}</CollectionPanel.Muted>
      <Button aria-pressed={picker} onClick={() => setPicker(!picker)}>
        {t(picker ? 'collections.members' : 'collections.picker')}
      </Button>
      <ReadState
        pending={state.isPending}
        emptyMessage={t(picker ? 'collections.emptyPicker' : 'collections.emptyMembers')}
        error={state.isError}
        empty={pagesEmpty(state.data)}
        retry={() => void state.refetch()}
      />
      <Button disabled={state.isFetching || busy} onClick={() => void state.refetch()}>
        {t('collections.retry')}
      </Button>
      <CollectionPanel.List>
        {members?.map((item) => (
          <MemberRow
            key={String(item.id)}
            title={item.title}
            picker={picker}
            disabled={busy || (picker && item.projectIds.includes(project))}
            onClick={() => void mutate(item.action)}
          />
        ))}
      </CollectionPanel.List>
      {state.hasNextPage ? (
        <Button disabled={state.isFetching} onClick={() => void state.fetchNextPage()}>
          {t('collections.more')}
        </Button>
      ) : null}
    </CollectionPanel.Members>
  );
}

function CreateCollection({ view }: { view: CollectionsView }) {
  const { t, client, draft, update, mutate, name, busy } = view;

  return (
    <>
      <CollectionPanel.CreateForm
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
        <CollectionPanel.CreateName>
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
        </CollectionPanel.CreateName>
        <Button type="submit" disabled={busy || draft.uncertain || !validCollectionName(name)}>
          {t('collections.create')}
        </Button>
      </CollectionPanel.CreateForm>
      <CreationStatus view={view} />
    </>
  );
}

function CollectionCatalog({ view }: { view: CollectionsView }) {
  const { t, draft, update, busy, list, selected } = view;

  return (
    <>
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
      <CollectionPanel.List>
        {list.data?.pages
          .flatMap((p) => p.items)
          .map((project) => (
            <CollectionPanel.CatalogRow key={String(project.id)}>
              <CollectionPanel.SelectCollection
                variant="ghost"

                onClick={() => update((value) => ({ ...value, selected: project.id }))}
                aria-pressed={draft.selected === project.id}
              >
                <SubjectIdentity name={project.name} icon={project.icon} />
                {project.name}
              </CollectionPanel.SelectCollection>
              <CollectionPanel.ExamDate>{project.examOn}</CollectionPanel.ExamDate>
            </CollectionPanel.CatalogRow>
          ))}
      </CollectionPanel.List>
      {list.hasNextPage ? (
        <Button disabled={list.isFetching} onClick={() => void list.fetchNextPage()}>
          {t('collections.more')}
        </Button>
      ) : null}
    </>
  );
}

function SelectedCollection({ view }: { view: CollectionsView }) {
  const { t, draft, update, mutate, busy, selected } = view;

  return (
    <>
      {draft.selected !== null && (
        <>
          {selected.isPending && <Loading label={t('collections.loading')} />}
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
                  <Button onClick={() => void selected.refetch()}>{t('collections.retry')}</Button>
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
    </>
  );
}

function MemberRow({
  title,
  picker,
  disabled,
  onClick
}: {
  title: string;
  picker: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const label = t(picker ? 'collections.add' : 'collections.detach');

  return (
    <CollectionPanel.MemberRow>
      <CollectionPanel.MemberTitle>{title}</CollectionPanel.MemberTitle>
      <CollectionPanel.MemberAction
        aria-label={label + ': ' + title}
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </CollectionPanel.MemberAction>
    </CollectionPanel.MemberRow>
  );
}

function CreationStatus({ view }: { view: CollectionsView }) {
  const { t, draft, update, busy, list } = view;

  return (
    <>
      {draft.uncertain && busy ? <StatusMessage>{t('collections.creating')}</StatusMessage> : null}
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
      {draft.accepted ? <StatusMessage>{t('collections.created')}</StatusMessage> : null}
      {draft.error ? (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={<>{t(collectionFailure(draft.error))}</>}
        />
      ) : null}
      <CollectionPanel.Muted>{t('collections.nameLimit')}</CollectionPanel.Muted>
    </>
  );
}

function pagesEmpty(data: { pages: readonly { items: readonly unknown[] }[] } | undefined) {
  return data?.pages.every((page) => page.items.length === 0) ?? false;
}

function collectionFailure(error: ErrorKind) {
  return error === 'invalid_input'
    ? 'collections.invalidName'
    : error === 'not_found'
      ? 'collections.missing'
      : 'collections.mutationError';
}
