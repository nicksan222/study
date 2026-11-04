import type { StudyDocumentVersion } from '@study/contracts/documents/types';
import type { StudyDocumentId, StudyDocumentVersionId } from '@study/contracts/ids';
import { studyDocumentVersionIdSchema } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { MaterialLibrary } from '@study/ui/material-library';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Schema } from 'effect';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { documentHistoryOptions } from '#web/lib/study-client/documents.queries.ts';
import { request } from '#web/lib/study-client/request.ts';

import { DocumentActions } from '../document-editing';
import { ContentReadError } from '../document-presentation/read-error';
import { DocumentMetadata } from '../session-workspace/session-document-metadata';
import { sessionDocumentOptions } from '../session-workspace/session-document.queries';
import { ExactAuthoredDocument } from './exact-document';
import { VersionExport } from './export';
import { EvidenceDetails } from './reader-evidence';
import { DocumentRetirement } from './retirement';

export function AuthoredDocumentReader({
  id,
  initialVersion
}: {
  id: StudyDocumentId;
  initialVersion?: string;
}) {
  const { t } = useI18n();
  const model = useAuthoredReader(id, initialVersion);
  const { document } = model;
  return (
    <MaterialLibrary.Reader>
      {document.isPending && <Loading label={t('LoadingStudy')} />}
      {document.error && (
        <ContentReadError error={document.error} retry={() => void document.refetch()} />
      )}
      {document.data && !document.error && (
        <AuthoredReaderContent value={document.data} model={model} />
      )}
    </MaterialLibrary.Reader>
  );
}
function useAuthoredReader(id: StudyDocumentId, initialVersion?: string) {
  const document = useQuery(sessionDocumentOptions(id));
  const [selected, setSelected] = useState<StudyDocumentVersionId | undefined>(() =>
    initialVersion
      ? Schema.decodeUnknownSync(studyDocumentVersionIdSchema)(BigInt(initialVersion))
      : undefined
  );
  const history = useInfiniteQuery(documentHistoryOptions(id));
  const exact = useQuery({
    queryKey: ['documents', 'version', String(selected)],
    enabled: selected !== undefined,
    queryFn: ({ signal }) => request((rpc) => rpc['documents.version']({ id: selected! }), signal)
  });
  const version =
    selected === undefined ? document.data?.version : exact.isError ? undefined : exact.data;

  return { document, history, exact, selected, setSelected, version, id };
}
function AuthoredReaderContent({
  value,
  model
}: {
  value: import('@study/contracts/documents/types').StudyDocument;
  model: ReturnType<typeof useAuthoredReader>;
}) {
  const { exact, selected, version, id } = model;
  return (
    <>
      <h1>{value.title}</h1>
      <DocumentMetadata document={value} />
      {exact.error && selected !== undefined && (
        <ContentReadError error={exact.error} retry={() => void exact.refetch()} />
      )}
      {version?.documentId === id && (
        <>
          <ExactAuthoredDocument id={version.id} documentId={id} />
          <VersionExport version={version} />
          <EvidenceDetails version={version} />
          <DocumentActions
            key={String(version.id)}
            version={version}
            current={value.headVersionId ?? version.id}
          />
        </>
      )}

      <AuthoredHistory model={model} />
      <DocumentRetirement document={value} />
    </>
  );
}
function AuthoredHistory({ model }: { model: ReturnType<typeof useAuthoredReader> }) {
  const { t } = useI18n();
  const { history, setSelected } = model;
  return (
    <details>
      <summary>{t('ReaderHistory')}</summary>
      {history.error && (
        <ContentReadError error={history.error} retry={() => void history.refetch()} />
      )}
      <Button variant="ghost" onClick={() => setSelected(undefined)}>
        {t('ReaderCurrent')}
      </Button>
      <MaterialLibrary.Rows>
        {history.data?.pages
          .flatMap((page) => page.items)
          .map((item) => (
            <li key={String(item.id)}>
              <Button variant="ghost" onClick={() => setSelected(item.id)}>
                {t('ReaderVersion')} {String(item.number)}
              </Button>
            </li>
          ))}
      </MaterialLibrary.Rows>
      {history.hasNextPage && (
        <Button disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
          {t('LibraryMore')}
        </Button>
      )}
    </details>
  );
}
