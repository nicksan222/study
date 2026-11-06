import type { MaterialId, ProjectId } from '@study/contracts/ids';
import { materialVersionIdSchema } from '@study/contracts/ids';
import type {
  MaterialDetailDto,
  MaterialVersionDetailDto
} from '@study/contracts/materials/schemas';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { Practice } from '@study/ui/practice';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';

import { materialId, materialOptions } from '#web/features/material-library/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';
import { versionOptions } from '#web/lib/study-client/materials.queries.ts';
import { projectsQueryOptions } from '#web/lib/study-client/study.queries.ts';

import { MaterialActions } from './context-actions';
import { FlashcardReview } from './flashcard-review';
import { Quiz } from './quiz';
import { PracticeWorkspace, PracticeSubject } from './workspace';

type Kind = 'quiz' | 'flashcards';

function MaterialPage({ kind }: { kind: Kind }) {
  const params = useParams({ strict: false });
  const id = materialId(params.materialId!);
  const state = useSuspenseQuery(materialOptions(id));
  const { t } = useI18n();
  const subjects = useQuery(projectsQueryOptions());
  const search = useSearch({ from: '__root__' });
  const project =
    state.data.projectIds.find((value) => String(value) === search.project) ??
    state.data.projectIds[0];

  const owner = subjects.data?.find((subject) => subject.id === project);

  return (
    <PracticeWorkspace
      title={state.data.title}
      parent={
        <Link to="/practice" search={project ? { project: String(project) } : {}}>
          {owner ? <PracticeSubject project={owner} /> : t('Practice')}
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
  const historical = useQuery({
    ...versionOptions(historicalId),
    enabled: search.version !== undefined
  });
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
        <Quiz
          key={String(version.id)}
          version={version}
          projectId={project}
          title={material.title}
        />
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
