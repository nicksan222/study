import type { DocumentId, MaterialVersionId } from '@study/contracts/ids';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useI18n } from '../../lib/i18n';
import { DocumentReader } from '../document-presentation';
import { exactImageOptions, exactDocumentOptions } from './material-library.queries';

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
  const state = useQuery(exactImageOptions(id, documentId, block.id));
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const value = state.data;

    const node = imageRef.current;

    if (!value || !node || state.isError) return;

    const url = URL.createObjectURL(new Blob([new Uint8Array(value.bytes)], { type: value.mime }));

    node.src = url;

    return () => {
      node.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [state.data, state.isError]);

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
      ) : state.data ? (
        <img ref={imageRef} alt={block.content.alt} />
      ) : (
        <Loading label={t('LoadingStudy')} />
      )}
      <figcaption>{block.content.alt}</figcaption>
    </figure>
  );
}

export function ExactDocument({ id }: { id: MaterialVersionId }) {
  const { t } = useI18n();
  const state = useQuery(exactDocumentOptions(id));

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

  if (!state.data) return <Loading label={t('LoadingStudy')} />;

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
