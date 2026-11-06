import { quizAttemptIdSchema } from '@study/contracts/ids';
import type { ProjectId } from '@study/contracts/ids';
import type { MaterialDetailDto } from '@study/contracts/materials/schemas';
import { ErrorState } from '@study/ui/error-state';
import { WorkspaceCard } from '@study/ui/workspace';
import { useQuery, useIsMutating } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { Archive, ArrowUpRight, FileText, Play, RotateCcw } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

import { AttemptsAction } from './history-dialog';
import { MaterialDocuments } from './material-documents';
import { attemptOptions, useMaterialArchive } from './practice.queries';

export function MaterialActions({ material }: { material: MaterialDetailDto }) {
  const { t } = useI18n();
  const busy = useIsMutating() > 0;
  const search = useSearch({ from: '__root__' });
  const project =
    material.projectIds.find((value) => String(value) === search.project) ?? material.projectIds[0];
  const scope = project ? { project: String(project) } : {};
  const attempt = useQuery({
    ...attemptOptions(Schema.decodeUnknownSync(quizAttemptIdSchema)(BigInt(search.attempt ?? '1'))),
    enabled: search.attempt !== undefined
  });
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
          <FileText aria-hidden="true" />
          <span>{t('PracticeViewMaterial')}</span>
          <ArrowUpRight aria-hidden="true" />
        </WorkspaceCard.Item>
        {material.kind === 'quiz' && (
          <>
            {search.attempt && (
              <WorkspaceCard.Item
                disabled={busy}
                render={
                  <Link
                    to="/practice/$materialId"
                    params={{ materialId: String(material.id) }}
                    search={scope}
                  />
                }
              >
                <Play aria-hidden="true" />
                <span>{t('PracticeNewQuiz')}</span>
              </WorkspaceCard.Item>
            )}
            <AttemptsAction id={material.id} />
          </>
        )}
      </WorkspaceCard.Group>
      <WorkspaceCard.Group>
        <MaterialDocuments version={version} materialId={material.id} />
      </WorkspaceCard.Group>
      <WorkspaceCard.Group>
        <ArchiveAction material={material} busy={busy} project={project} />
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
          mutation.mutate(undefined, {
            onSuccess: () => {
              if (!archived)
                void navigate({
                  to: '/practice',
                  search: project ? { project: String(project) } : {}
                });
            }
          })
        }
      >
        {archived ? <RotateCcw aria-hidden="true" /> : <Archive aria-hidden="true" />}
        <span>{t(archived ? 'PracticeRestore' : 'PracticeArchiveMaterial')}</span>
      </WorkspaceCard.Item>
      {mutation.isError && <ErrorState layout="inline" title={t('PracticeArchiveError')} />}
    </>
  );
}
