import { materialVersionIdSchema } from '@study/contracts';
import type { PageId, PageVersionId, MaterialId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { OpenIcon, PageIcon } from '@study/icons';
import { ErrorState, WorkspaceCard } from '@study/ui';
import { Link } from '@tanstack/react-router';

import { useI18n } from '#client/lib/i18n.tsx';

export function MaterialPages({
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
            to="/pages/$pageId"
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
