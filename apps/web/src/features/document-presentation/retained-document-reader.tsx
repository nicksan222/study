import type { ContentSnapshotId } from '@study/contracts/ids';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { DocumentReader } from './document-reader';
import { retainedImageOptions } from './retained-document.queries';

type Document = typeof documentSchema.Type;
/** Canonical image references resolve retained original revisions through Sources. */

export function RetainedDocumentReader({
  document,
  snapshotId
}: {
  document: Document;
  snapshotId: ContentSnapshotId;
}) {
  return (
    <DocumentReader
      document={document}
      renderImage={(block) =>
        block.content.type === 'image' ? (
          <RetainedImage
            key={`${snapshotId}:${block.id}`}
            snapshotId={snapshotId}
            blockId={block.id}
            image={block.content}
          />
        ) : null
      }
    />
  );
}

function RetainedImage({
  snapshotId,
  blockId,
  image
}: {
  snapshotId: ContentSnapshotId;
  blockId: string;
  image: Extract<Document['blocks'][number]['content'], { type: 'image' }>;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLImageElement>(null);
  const state = useQuery(retainedImageOptions(snapshotId, blockId, image));

  useEffect(() => {
    const node = ref.current;
    const value = state.data;

    if (!node || !value || state.isError) return;

    const url = URL.createObjectURL(new Blob([new Uint8Array(value.bytes)], { type: value.mime }));

    node.src = url;

    return () => {
      node.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [state.data, state.isError]);

  if (state.isPending) return <Loading label={t('LoadingStudy')} />;

  if (state.isError)
    return (
      <ErrorState
        title={t('ReaderImageUnavailable')}
        action={<Button onClick={() => void state.refetch()}>{t('ReaderRetryImage')}</Button>}
      />
    );

  return <img ref={ref} alt={image.alt} width={image.width} height={image.height} />;
}
