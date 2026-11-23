import type { ProjectId, Source, SourceId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { AddIcon, SourcesIcon } from '@study/icons';
import { age } from '@study/localization';
import {
  ErrorState,
  IconButton,
  Sidebar,
  Loading,
  RetryButton,
  Spinner,
  toastManager,
  SubjectWorkspace,
  WorkspaceSurface,
  useNowMinute
} from '@study/ui';
import { Link, useParams } from '@tanstack/react-router';
import { useLayoutEffect, useRef, useState } from 'react';

import {
  CursorWindowActions,
  useCursorRecovery,
  useCursorWindow
} from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';
import { sourceIcons } from '#client/lib/source-icons.ts';
import { useNarrowLayout } from '#client/lib/viewport.ts';

import { useExtractionJob } from './source-panel.queries';

export function UploadedMaterialsPage() {
  const { t } = useI18n();

  return (
    <WorkspaceSurface.Root variant="page">
      <WorkspaceSurface.Content inset="none">
        <SubjectWorkspace.Empty>
          <SubjectWorkspace.EmptyContent>
            <SubjectWorkspace.EmptyIcon>
              <SourcesIcon aria-hidden="true" />
            </SubjectWorkspace.EmptyIcon>
            <SubjectWorkspace.EmptyTitle>
              {t('UploadedMaterialsChoose')}
            </SubjectWorkspace.EmptyTitle>
          </SubjectWorkspace.EmptyContent>
        </SubjectWorkspace.Empty>
      </WorkspaceSurface.Content>
    </WorkspaceSurface.Root>
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
  project: ProjectId | null;
  query: string;
  onReselect: () => void;
}) {
  const { t } = useI18n();
  const { sourceId } = useParams({ strict: false });
  const narrow = useNarrowLayout();
  const now = useNowMinute();
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
          now={now}
          active={sourceId === String(source.id)}
          onReselect={narrow ? onReselect : undefined}
        />
      ))}
      {state.isSuccess && !state.data?.items.length && (
        <Sidebar.Message role="status">
          {t(
            nameContains
              ? 'SearchNoResults'
              : project
                ? 'UploadedMaterialsEmpty'
                : 'UploadedMaterialsEmptyGlobal'
          )}
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
  now,
  active,
  onReselect
}: {
  source: Source;
  project: ProjectId | null;
  now: number;
  active: boolean;
  onReselect?: () => void;
}) {
  const { t, locale, date } = useI18n();
  const job = useExtractionJob(source.id, source);
  const status = t(job.sidebar);
  const kind = t(`sourceKind.${source.kind}`);
  const added = date(source.createdAt);
  const details = `${kind} · ${status} · ${t('UploadedMaterialsAdded')} ${added}`;
  const Icon = sourceIcons[source.kind];
  const link = useRef<HTMLAnchorElement>(null);

  useLayoutEffect(() => {
    if (active) link.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <Sidebar.Item
      label={source.name}
      announcement={`${source.name} · ${status}`}
      aria-label={source.name}
      title={`${source.name} · ${details}`}
      aria-description={details}
      icon={<Icon aria-hidden="true" />}
      context={kind}
      timestamp={
        <time dateTime={new Date(Number(source.createdAt) * 1000).toISOString()} title={added}>
          {age(locale, now - Number(source.createdAt))}
        </time>
      }
      description={status}
      aria-current={active ? 'page' : undefined}
      render={
        <Link
          ref={link}
          to="/sources/$sourceId"
          params={{ sourceId: String(source.id) }}
          search={{ project: project ? String(project) : undefined, fromUploads: '1' }}
          onClick={active ? onReselect : undefined}
        />
      }
    />
  );
}
