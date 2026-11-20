import { contentInputKey, materialVersionIdSchema } from '@study/contracts';
import type { ContentInput, NoteId, PageId, PageVersionId, MaterialId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { NoteIcon, OpenIcon, PageIcon, SourcesIcon } from '@study/icons';
import { ErrorState, WorkspaceCard } from '@study/ui';
import { Link } from '@tanstack/react-router';

import { useI18n } from '#client/lib/i18n.tsx';

export function MaterialSources({
  version,
  materialId
}: {
  version?: string;
  materialId: MaterialId;
}) {
  const { t } = useI18n();
  const state = rpc.materials.version.useQuery(
    { id: materialVersionIdSchema.make(BigInt(version ?? '1')) },
    { enabled: version !== undefined }
  );
  const inputs = state.data?.material_id === materialId ? state.data.inputs : [];

  return (
    <>
      <WorkspaceCard.Caption>{t('PracticeEvidence')}</WorkspaceCard.Caption>
      {state.isError ? (
        <ErrorState layout="inline" title={t('PracticeLoadError')} />
      ) : (
        inputs.map((input) => <EvidenceLink key={contentInputKey(input)} input={input} />)
      )}
      {state.isSuccess && inputs.length === 0 && (
        <WorkspaceCard.Caption>{t('PracticeNoEvidence')}</WorkspaceCard.Caption>
      )}
    </>
  );
}

function EvidenceLink({ input }: { input: ContentInput }) {
  switch (input.kind) {
    case 'page':
      return <SourcePage id={input.versionId} />;
    case 'source':
      return <SourceExtraction input={input} />;
    case 'note':
      return <CapturedNotebook requestId={input.contextId} />;
  }
}

function SourceExtraction({ input }: { input: Extract<ContentInput, { kind: 'source' }> }) {
  const { t } = useI18n();
  const source = rpc.sources.get.useQuery({ id: input.sourceId });

  return (
    <WorkspaceCard.Item
      disabled={!source.data}
      render={
        source.data ? (
          <Link
            to="/sources/$sourceId"
            params={{ sourceId: String(input.sourceId) }}
            search={{
              sourceRevision: String(input.revision),
              sourceSnapshot: String(input.snapshotId)
            }}
          />
        ) : undefined
      }
    >
      <SourcesIcon aria-hidden="true" />
      <span>{source.data?.name ?? t(source.isError ? 'ReaderUnavailable' : 'LoadingStudy')}</span>
      {source.data && <OpenIcon aria-hidden="true" />}
    </WorkspaceCard.Item>
  );
}

function CapturedNotebook({ requestId }: { requestId: string }) {
  const { t } = useI18n();
  const capture = rpc.notes.inspectNoteContext.useQuery({ requestId });

  return capture.data ? (
    <NotebookLink id={capture.data.noteId} />
  ) : (
    <WorkspaceCard.Item disabled>
      <NoteIcon aria-hidden="true" />
      <span>{t(capture.isError ? 'ReaderUnavailable' : 'LoadingStudy')}</span>
    </WorkspaceCard.Item>
  );
}

function NotebookLink({ id }: { id: NoteId }) {
  const { t } = useI18n();
  const note = rpc.notes.get.useQuery({ id });

  return (
    <WorkspaceCard.Item
      disabled={!note.data}
      render={note.data ? <Link to="/notes/$noteId" params={{ noteId: id }} /> : undefined}
    >
      <NoteIcon aria-hidden="true" />
      <span>{note.data?.title ?? t(note.isError ? 'ReaderUnavailable' : 'LoadingStudy')}</span>
      {note.data && <OpenIcon aria-hidden="true" />}
    </WorkspaceCard.Item>
  );
}

function SourcePage({ id }: { id: PageVersionId }) {
  const { t } = useI18n();
  const version = rpc.pages.version.useQuery({ id });

  return version.data ? (
    <PageLink id={version.data.pageId} version={id} />
  ) : (
    <WorkspaceCard.Item disabled>
      <PageIcon aria-hidden="true" />
      <span>{t(version.isError ? 'ReaderUnavailable' : 'LoadingStudy')}</span>
    </WorkspaceCard.Item>
  );
}

function PageLink({ id, version }: { id: PageId; version: PageVersionId }) {
  const { t } = useI18n();
  const page = rpc.pages.get.useQuery({ id });

  return (
    <WorkspaceCard.Item
      disabled={!page.data}
      render={
        page.data ? (
          <Link
            to="/practice/study-notes/$pageId"
            params={{ pageId: String(id) }}
            search={{ pageVersion: String(version) }}
          />
        ) : undefined
      }
    >
      <PageIcon aria-hidden="true" />
      <span>{page.data?.title ?? t(page.isError ? 'ReaderUnavailable' : 'LoadingStudy')}</span>
      <OpenIcon aria-hidden="true" />
    </WorkspaceCard.Item>
  );
}
