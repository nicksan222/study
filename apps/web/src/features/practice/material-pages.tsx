import { materialVersionIdSchema } from '@study/contracts/ids';
import type { PageVersionId, MaterialId } from '@study/contracts/ids';
import { ErrorState } from '@study/ui/error-state';
import { WorkspaceCard } from '@study/ui/workspace';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Schema } from 'effect';
import { ArrowUpRight, FileText } from 'lucide-react';

import { notePageOptions } from '#web/features/note-workspace/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';
import { versionOptions } from '#web/lib/study-client/materials.queries.ts';
import { pageVersionOptions } from '#web/lib/study-client/pages.queries.ts';

export function MaterialPages({
  version,
  materialId
}: {
  version?: string;
  materialId: MaterialId;
}) {
  const { t } = useI18n();
  const state = useQuery({
    ...versionOptions(Schema.decodeUnknownSync(materialVersionIdSchema)(BigInt(version ?? '1'))),
    enabled: version !== undefined
  });
  const inputs =
    state.data?.material_id === materialId
      ? state.data.inputs.filter((input) => input.kind === 'page')
      : [];

  return (
    <>
      <WorkspaceCard.Caption>{t('PracticeSourcePages')}</WorkspaceCard.Caption>
      {state.isError ? (
        <ErrorState layout="inline" title={t('PracticeLoadError')} />
      ) : (
        inputs.map((input) => <SourcePage key={String(input.versionId)} id={input.versionId} />)
      )}
      {state.isSuccess && inputs.length === 0 && (
        <WorkspaceCard.Caption>{t('PracticeNoSourcePages')}</WorkspaceCard.Caption>
      )}
    </>
  );
}

function SourcePage({ id }: { id: PageVersionId }) {
  const { t } = useI18n();
  const version = useQuery(pageVersionOptions(id));

  return version.data ? (
    <PageLink id={version.data.pageId} version={id} />
  ) : (
    <WorkspaceCard.Item disabled>
      <FileText aria-hidden="true" />
      <span>{t(version.isError ? 'ReaderUnavailable' : 'LoadingStudy')}</span>
    </WorkspaceCard.Item>
  );
}

function PageLink({
  id,
  version
}: {
  id: Parameters<typeof notePageOptions>[0];
  version: PageVersionId;
}) {
  const { t } = useI18n();
  const document = useQuery(notePageOptions(id));

  return (
    <WorkspaceCard.Item
      disabled={!document.data}
      render={
        document.data ? (
          <Link
            to="/pages/$pageId"
            params={{ pageId: String(id) }}
            search={{ pageVersion: String(version) }}
          />
        ) : undefined
      }
    >
      <FileText aria-hidden="true" />
      <span>
        {document.data?.title ?? t(document.isError ? 'ReaderUnavailable' : 'LoadingStudy')}
      </span>
      <ArrowUpRight aria-hidden="true" />
    </WorkspaceCard.Item>
  );
}
