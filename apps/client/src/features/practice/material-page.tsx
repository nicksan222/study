import { materialVersionIdSchema } from '@study/contracts';
import type {
  MaterialId,
  ProjectId,
  MaterialDetailDto,
  MaterialVersionDetailDto
} from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Button, ErrorState, Loading, Practice } from '@study/ui';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';

import { materialId } from '#client/features/material-library/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import { MaterialActions } from './context-actions';
import { FlashcardReview } from './flashcard-review';
import { Quiz } from './quiz';
import { PracticeWorkspace } from './workspace';

type Kind = 'quiz' | 'flashcards';

function MaterialPage({ kind }: { kind: Kind }) {
  const params = useParams({ strict: false });
  const id = materialId(params.materialId!);
  const state = rpc.materials.get.useQuery({ id });
  const { t } = useI18n();
  const subjects = rpc.projects.list.useQuery({ limit: 100 });
  const search = useSearch({ from: '__root__' });

  if (!state.data)
    return state.isError ? (
      <Unavailable retry={state.retry} />
    ) : (
      <Loading label={t('LoadingPractice')} />
    );

  const project =
    state.data.projectIds.find((value) => String(value) === search.project) ??
    state.data.projectIds[0];

  const owner = subjects.data?.items.find((subject) => subject.id === project);

  return (
    <PracticeWorkspace
      title={state.data.title}
      parent={
        <Link to="/practice" search={project ? { project: String(project) } : {}}>
          {owner ? owner.name : t('Practice')}
        </Link>
      }
      actions={<MaterialActions key={String(id)} material={state.data} />}
    >
      <Practice.Content>
        <MaterialContent id={id} kind={kind} material={state.data} project={project} />
      </Practice.Content>
    </PracticeWorkspace>
  );
}

function MaterialContent({
  id,
  kind,
  material,
  project
}: {
  id: MaterialId;
  kind: Kind;
  material: MaterialDetailDto;
  project?: ProjectId;
}) {
  const { t } = useI18n();
  const search = useSearch({ from: '__root__' });
  const historicalId = Schema.decodeUnknownSync(materialVersionIdSchema)(
    BigInt(search.version ?? '1')
  );
  const historical = rpc.materials.version.useQuery(
    { id: historicalId },
    { enabled: search.version !== undefined }
  );
  const version = search.version ? historical.data : material.latestPublishedVersion;

  if (search.version && historical.isPending) return <Loading label={t('LoadingPractice')} />;

  if (search.version && historical.isError)
    return <Unavailable retry={() => void historical.refetch()} />;

  if (material.archived_at !== null)
    return <ErrorState title={t('PracticeArchived')} description={t('PracticeArchiveHelp')} />;

  if (!usableVersion(version, id, kind)) return <Unavailable />;

  return (
    <>
      {version.kind === 'flashcards' ? (
        <FlashcardReview key={String(version.id)} version={version} project={project} />
      ) : (
        <Quiz key={String(version.id)} version={version} projectId={project} />
      )}
    </>
  );
}

function usableVersion(
  version: MaterialVersionDetailDto | null | undefined,
  id: MaterialId,
  kind: Kind
): version is MaterialVersionDetailDto {
  return Boolean(
    version && version.material_id === id && version.kind === kind && version.status === 'published'
  );
}

function Unavailable({ retry }: { retry?: () => void }) {
  const { t } = useI18n();

  return (
    <ErrorState
      title={t('ReaderUnavailable')}
      description={t('PracticeUnavailable')}
      action={retry && <Button onClick={retry}>{t('LibraryRefresh')}</Button>}
    />
  );
}

export function QuizMaterialPage() {
  return <MaterialPage kind="quiz" />;
}

export function FlashcardsMaterialPage() {
  return <MaterialPage kind="flashcards" />;
}
