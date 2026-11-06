import { materialVersionIdSchema } from '@study/contracts/ids';
import type { StudyDocumentVersionId, MaterialId } from '@study/contracts/ids';
import { ErrorState } from '@study/ui/error-state';
import { WorkspaceCard } from '@study/ui/workspace';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Schema } from 'effect';
import { ArrowUpRight, FileText } from 'lucide-react';

import { sessionDocumentOptions } from '#web/features/session-workspace/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';
import { documentVersionOptions } from '#web/lib/study-client/documents.queries.ts';
import { versionOptions } from '#web/lib/study-client/materials.queries.ts';

export function MaterialDocuments({
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
      ? state.data.inputs.filter((input) => input.kind === 'document')
      : [];

  return (
    <>
      <WorkspaceCard.Caption>{t('PracticeSourceDocuments')}</WorkspaceCard.Caption>
      {state.isError ? (
        <ErrorState layout="inline" title={t('PracticeLoadError')} />
      ) : (
        inputs.map((input) => <SourceDocument key={String(input.versionId)} id={input.versionId} />)
      )}
      {state.isSuccess && inputs.length === 0 && (
        <WorkspaceCard.Caption>{t('PracticeNoSourceDocuments')}</WorkspaceCard.Caption>
      )}
    </>
  );
}

function SourceDocument({ id }: { id: StudyDocumentVersionId }) {
  const { t } = useI18n();
  const version = useQuery(documentVersionOptions(id));

  return version.data ? (
    <DocumentLink id={version.data.documentId} version={id} />
  ) : (
    <WorkspaceCard.Item disabled>
      <FileText aria-hidden="true" />
      <span>{t(version.isError ? 'ReaderUnavailable' : 'LoadingStudy')}</span>
    </WorkspaceCard.Item>
  );
}

function DocumentLink({
  id,
  version
}: {
  id: Parameters<typeof sessionDocumentOptions>[0];
  version: StudyDocumentVersionId;
}) {
  const { t } = useI18n();
  const document = useQuery(sessionDocumentOptions(id));

  return (
    <WorkspaceCard.Item
      disabled={!document.data}
      render={
        document.data ? (
          <Link
            to="/documents/$documentId"
            params={{ documentId: String(id) }}
            search={{ documentVersion: String(version) }}
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
