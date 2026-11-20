import { projectIdSchema } from '@study/contracts';
import type { ProjectId, Source, SourceId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { AddIcon, SourcesIcon } from '@study/icons';
import {
  Button,
  ErrorState,
  List,
  Loading,
  RetryButton,
  StatusMessage,
  SubjectWorkspace
} from '@study/ui';
import { Link, useSearch } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import {
  CursorWindowActions,
  useCursorRecovery,
  useCursorWindow
} from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { useSourceProcessingExecution } from './source-panel.queries';

export function UploadedMaterialsPage() {
  const { project } = useSearch({ from: '__root__' });
  const { t } = useI18n();
  const id = project ? projectIdSchema.make(BigInt(project)) : undefined;
  const subject = rpc.projects.get.useQuery(id ? { id } : undefined);

  return (
    <>
      <SubjectWorkspace.Header>
        <SubjectWorkspace.Identity>
          <SubjectWorkspace.Title>{t('UploadedMaterials')}</SubjectWorkspace.Title>
        </SubjectWorkspace.Identity>
        {subject.data && !subject.isError && (
          <SubjectWorkspace.Actions>
            <UploadFiles key={String(subject.data.id)} project={subject.data.id} />
          </SubjectWorkspace.Actions>
        )}
      </SubjectWorkspace.Header>
      {!id ? (
        <Button variant="outline" render={<Link to="/projects" search={{}} />}>
          {t('Projects')}
        </Button>
      ) : subject.isPending ? (
        <Loading label={t('LoadingSubjects')} />
      ) : subject.isError ? (
        <ErrorState
          title={t('SubjectsLoadError')}
          action={<RetryButton label={t('Retry')} onClick={subject.retry} />}
        />
      ) : subject.data ? (
        <UploadedFiles project={subject.data.id} />
      ) : null}
    </>
  );
}

function UploadFiles({ project }: { project: ProjectId }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);

  async function upload(files: File[]) {
    setBusy(true);
    setFailed([]);

    for (const file of files) {
      try {
        await rpc.sources.create.call({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          projectId: project
        });
      } catch {
        setFailed((names) => [...names, file.name]);
      }
    }

    setBusy(false);
  }

  return (
    <div>
      <Button disabled={busy} onClick={() => input.current?.click()}>
        <AddIcon aria-hidden="true" />
        {t(busy ? 'NoteUploading' : 'UploadedMaterialsAdd')}
      </Button>
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
      {failed.length > 0 && (
        <StatusMessage>
          {t('UploadedMaterialsUnconfirmed')} {failed.join(', ')}
        </StatusMessage>
      )}
    </div>
  );
}

function UploadedFiles({ project }: { project: ProjectId }) {
  const { t } = useI18n();
  const window = useCursorWindow<SourceId>(String(project));
  const state = rpc.sources.list.useQuery({
    uploadedFor: project,
    limit: window.limit,
    before: window.cursor
  });

  useCursorRecovery(window, state.error);

  if (state.isPending) return <Loading label={t('LoadingStudy')} />;

  if (state.isError)
    return (
      <ErrorState
        title={t('collections.readError')}
        action={<RetryButton label={t('Retry')} onClick={state.retry} />}
      />
    );

  if (!state.data?.items.length)
    return <SubjectWorkspace.EmptyList>{t('UploadedMaterialsEmpty')}</SubjectWorkspace.EmptyList>;

  return (
    <SubjectWorkspace.Section aria-label={t('UploadedMaterials')}>
      <List bleed={false}>
        {state.data.items.map((source) => (
          <UploadedFile key={String(source.id)} source={source} project={project} />
        ))}
      </List>
      <CursorWindowActions
        {...window}
        hasMore={state.data.next !== null}
        pending={state.isFetching}
        more={() => window.more(state.data?.next)}
      />
    </SubjectWorkspace.Section>
  );
}

function UploadedFile({ source, project }: { source: Source; project: ProjectId }) {
  const { t } = useI18n();
  const state = useSourceProcessingExecution(source.id);
  const execution = state.data;
  const status = state.isError
    ? 'UploadedMaterialsStatusUnavailable'
    : execution?.outcome === 'failure'
      ? 'UploadedMaterialsFailed'
      : execution?.configurationWaitReason
        ? 'UploadedMaterialsWaiting'
        : execution?.outcome === 'success' || (!execution && state.documentId)
          ? 'UploadedMaterialsReady'
          : 'NotePending';

  return (
    <List.Row
      render={
        <Link
          to="/sources/$sourceId"
          params={{ sourceId: String(source.id) }}
          search={{ project: String(project), fromUploads: '1' }}
        />
      }
    >
      <List.Icon>
        <SourcesIcon aria-hidden="true" />
      </List.Icon>
      <List.Main>
        <List.Title>{source.name}</List.Title>
        <List.Description>
          {t(`sourceKind.${source.kind}`)} · {t(status)}
        </List.Description>
      </List.Main>
    </List.Row>
  );
}
