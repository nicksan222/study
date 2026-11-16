import { quizAttemptIdSchema } from '@study/contracts';
import type { ProjectId, MaterialDetailDto } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { ArchiveIcon, OpenIcon, PageIcon, StartIcon, RetryIcon } from '@study/icons';
import { ErrorState, WorkspaceCard } from '@study/ui';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';

import { useI18n } from '#client/lib/i18n.tsx';

import { AttemptsAction } from './history-dialog';
import { MaterialPages } from './material-pages';
import { useMaterialArchive } from './practice.queries';

export function MaterialActions({ material }: { material: MaterialDetailDto }) {
  const { t } = useI18n();
  const search = useSearch({ from: '__root__' });
  const project =
    material.projectIds.find((value) => String(value) === search.project) ?? material.projectIds[0];
  const scope = project ? { project: String(project) } : {};
  const attempt = rpc.learning.attempt.useQuery(
    { attemptId: quizAttemptIdSchema.make(BigInt(search.attempt ?? '1')) },
    { enabled: search.attempt !== undefined }
  );
  const version = search.attempt
    ? attempt.data?.materialId === material.id
      ? attempt.data.versionId.toString()
      : undefined
    : (search.version ?? material.latestPublishedVersion?.id.toString());

  return (
    <>
      <WorkspaceCard.Group>
        <WorkspaceCard.Item
          disabled={!version}
          render={
            <Link
              to="/materials/$materialId"
              params={{ materialId: String(material.id) }}
              search={{ ...scope, version }}
            />
          }
        >
          <PageIcon aria-hidden="true" />
          <span>{t('PracticeViewMaterial')}</span>
          <OpenIcon aria-hidden="true" />
        </WorkspaceCard.Item>
        {material.kind === 'quiz' && (
          <>
            {search.attempt && (
              <WorkspaceCard.Item
                disabled={false}
                render={
                  <Link
                    to="/practice/$materialId"
                    params={{ materialId: String(material.id) }}
                    search={scope}
                  />
                }
              >
                <StartIcon aria-hidden="true" />
                <span>{t('PracticeNewQuiz')}</span>
              </WorkspaceCard.Item>
            )}
            <AttemptsAction id={material.id} />
          </>
        )}
      </WorkspaceCard.Group>
      <WorkspaceCard.Group>
        <MaterialPages version={version} materialId={material.id} />
      </WorkspaceCard.Group>
      <WorkspaceCard.Group>
        <ArchiveAction material={material} busy={false} project={project} />
      </WorkspaceCard.Group>
    </>
  );
}

function ArchiveAction({
  material,
  busy,
  project
}: {
  material: MaterialDetailDto;
  busy: boolean;
  project?: ProjectId;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const archived = material.archived_at !== null;
  const mutation = useMaterialArchive(material.id, archived);

  return (
    <>
      <WorkspaceCard.Item
        disabled={mutation.isPending || busy}
        onClick={() =>
          void mutation
            .mutate()
            .then(() => {
              if (!archived)
                void navigate({
                  to: '/practice',
                  search: project ? { project: String(project) } : {}
                });
            })
            .catch(() => {})
        }
      >
        {archived ? <RetryIcon aria-hidden="true" /> : <ArchiveIcon aria-hidden="true" />}
        <span>{t(archived ? 'PracticeRestore' : 'PracticeArchiveMaterial')}</span>
      </WorkspaceCard.Item>
      {mutation.isError && <ErrorState layout="inline" title={t('PracticeArchiveError')} />}
    </>
  );
}
