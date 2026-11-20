import type { ProjectId, Source, SourceId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { AddIcon, SourcesIcon } from '@study/icons';
import {
  Button,
  ErrorState,
  IconButton,
  Sidebar,
  Loading,
  RetryButton,
  Spinner,
  toastManager,
  SubjectWorkspace
} from '@study/ui';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import {
  CursorWindowActions,
  useCursorRecovery,
  useCursorWindow
} from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';
import { useNarrowLayout } from '#client/lib/viewport.ts';

import { useSourceProcessingExecution } from './source-panel.queries';

export function UploadedMaterialsPage() {
  const { project } = useSearch({ from: '__root__' });
  const { t } = useI18n();

  return (
    <SubjectWorkspace.Empty>
      <SubjectWorkspace.EmptyContent>
        <SubjectWorkspace.EmptyIcon>
          <SourcesIcon aria-hidden="true" />
        </SubjectWorkspace.EmptyIcon>
        <SubjectWorkspace.EmptyTitle>
          {t(project ? 'UploadedMaterialsChoose' : 'ChooseProject')}
        </SubjectWorkspace.EmptyTitle>
        {!project && (
          <Button variant="outline" render={<Link to="/projects" search={{}} />}>
            {t('Projects')}
          </Button>
        )}
      </SubjectWorkspace.EmptyContent>
    </SubjectWorkspace.Empty>
  );
}

export function UploadMaterialAction({ project }: { project: ProjectId }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(files: File[]) {
    setBusy(true);
    const failed: string[] = [];

    for (const file of files) {
      try {
        await rpc.sources.create.call({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          projectId: project
        });
      } catch {
        failed.push(file.name);
      }
    }

    setBusy(false);

    if (failed.length)
      toastManager.add({
        type: 'error',
        title: t('UploadedMaterialsUnconfirmed'),
        description: failed.join(', ')
      });
  }

  return (
    <>
      <IconButton
        size="icon"
        variant="ghost-muted"
        label={t(busy ? 'NoteUploading' : 'UploadedMaterialsAdd')}
        disabled={busy}
        aria-busy={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? (
          <Spinner size="xs" label={t('NoteUploading')} aria-hidden="true" />
        ) : (
          <AddIcon aria-hidden="true" />
        )}
      </IconButton>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);

          event.currentTarget.value = '';

          if (files.length) void upload(files);
        }}
      />
    </>
  );
}

export function UploadedMaterialsSidebar({
  project,
  query,
  onReselect
}: {
  project: ProjectId;
  query: string;
  onReselect: () => void;
}) {
  const { t } = useI18n();
  const { sourceId } = useParams({ strict: false });
  const narrow = useNarrowLayout();
  const nameContains = query.trim();
  const window = useCursorWindow<SourceId>(nameContains);
  const state = rpc.sources.list.useQuery({
    uploadedFor: project,
    nameContains: nameContains || undefined,
    limit: window.limit,
    before: window.cursor
  });

  useCursorRecovery(window, state.error);

  return (
    <Sidebar.Items aria-label={t('UploadedMaterials')}>
      {state.isPending && <Loading layout="sidebar" label={t('LoadingStudy')} />}
      {state.isError && (
        <ErrorState
          layout="sidebar"
          title={t('collections.readError')}
          action={<RetryButton label={t('Retry')} onClick={state.retry} />}
        />
      )}
      {state.data?.items.map((source) => (
        <UploadedFile
          key={String(source.id)}
          source={source}
          project={project}
          active={sourceId === String(source.id)}
          onReselect={narrow ? onReselect : undefined}
        />
      ))}
      {state.isSuccess && !state.data?.items.length && (
        <Sidebar.Message role="status">
          {t(nameContains ? 'SearchNoResults' : 'UploadedMaterialsEmpty')}
        </Sidebar.Message>
      )}
      <CursorWindowActions
        {...window}
        hasMore={state.data?.next != null}
        pending={state.isFetching}
        more={() => window.more(state.data?.next)}
      />
    </Sidebar.Items>
  );
}

function UploadedFile({
  source,
  project,
  active,
  onReselect
}: {
  source: Source;
  project: ProjectId;
  active: boolean;
  onReselect?: () => void;
}) {
  const { t } = useI18n();
  const status = materialStatus(useSourceProcessingExecution(source.id));

  return (
    <Sidebar.Item
      layout="compact"
      descriptionBelow
      label={source.name}
      title={`${source.name} · ${t(`sourceKind.${source.kind}`)} · ${t(status)}`}
      aria-description={status === 'UploadedMaterialsReady' ? t(status) : undefined}
      description={status === 'UploadedMaterialsReady' ? undefined : t(status)}
      icon={<SourcesIcon aria-hidden="true" />}
      aria-current={active ? 'page' : undefined}
      render={
        <Link
          to="/sources/$sourceId"
          params={{ sourceId: String(source.id) }}
          search={{ project: String(project), fromUploads: '1' }}
          onClick={active ? onReselect : undefined}
        />
      }
    />
  );
}

function materialStatus({
  isError,
  data,
  documentId
}: ReturnType<typeof useSourceProcessingExecution>) {
  if (isError) return 'UploadedMaterialsStatusUnavailable';

  if (!data) return documentId ? 'UploadedMaterialsReady' : 'NotePending';

  if (data.outcome === 'failure')
    return data.failureKind === 'unsupported' ? 'MaterialOriginalOnly' : 'UploadedMaterialsFailed';

  if (data.configurationWaitReason) return 'UploadedMaterialsWaiting';

  if (data.outcome === 'success') return 'UploadedMaterialsReady';

  return 'NotePending';
}
