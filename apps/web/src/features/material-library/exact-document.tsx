import type { DocumentId, MaterialVersionId } from '@study/contracts/ids';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { request } from '../../lib/study-client/request';
import { DocumentReader } from './document-reader';

function ExactImage({
  id,
  documentId,
  block
}: {
  id: MaterialVersionId;
  documentId: DocumentId;
  block: (typeof documentSchema.Type.blocks)[number];
}) {
  const { t } = useI18n();
  const state = useQuery({
    queryKey: ['materials', 'image', String(id), String(documentId), block.id],
    queryFn: ({ signal }) =>
      request(
        (rpc) => rpc['materials.materialVersionImage']({ id, documentId, blockId: block.id }),
        signal
      ),
    gcTime: 0,
    retry: false
  });
  const [image, setImage] = useState<{ data: typeof state.data; url: string }>();
  useEffect(() => {
    const value = state.data;
    if (!value) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(value.bytes)], { type: value.mime }));
    setImage({ data: value, url });
    return () => URL.revokeObjectURL(url);
  }, [state.data]);
  if (block.content.type !== 'image') return null;
  return (
    <figure>
      {state.isError ? (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={
            <>
              <p>{t('ReaderImageUnavailable')}</p>
              <Button disabled={state.isFetching} onClick={() => void state.refetch()}>
                {t('ReaderRetryImage')}
              </Button>
            </>
          }
        />
      ) : image && image.data === state.data ? (
        <img src={image.url} alt={block.content.alt} />
      ) : (
        <p role="status">{t('LoadingStudy')}</p>
      )}
      <figcaption>{block.content.alt}</figcaption>
    </figure>
  );
}

export function ExactDocument({ id }: { id: MaterialVersionId }) {
  const { t } = useI18n();
  const state = useQuery({
    queryKey: ['materials', 'document', String(id)],
    queryFn: ({ signal }) =>
      request((rpc) => rpc['materials.materialVersionDocument']({ id }), signal)
  });
  if (state.isError)
    return (
      <ErrorState
        title={t('ErrorStateTitle')}
        description={
          <>
            <p>{t('ReaderUnavailable')}</p>
            <Button disabled={state.isFetching} onClick={() => void state.refetch()}>
              {t('LibraryRefresh')}
            </Button>
          </>
        }
      />
    );
  if (!state.data) return <p role="status">{t('LoadingStudy')}</p>;
  const value = state.data;
  return (
    <DocumentReader
      document={value.document}
      renderImage={(block) => (
        <ExactImage
          key={String(id) + ':' + value.id + ':' + block.id}
          id={id}
          documentId={value.id}
          block={block}
        />
      )}
    />
  );
}
