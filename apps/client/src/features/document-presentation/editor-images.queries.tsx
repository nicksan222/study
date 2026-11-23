import { StudyError } from '@study/contracts';
import type { ContentSnapshotId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { EditableDocument } from './document-editor-content';

type Image = Extract<EditableDocument['blocks'][number]['content'], { type: 'image' }>;

type Preview = { url?: string; error?: unknown };

/** Each retained image owns a canonical live query and a scoped object URL. */
function ImageSubscription({
  image,
  identity,
  publish,
  retry
}: {
  image: Image;
  identity: string;
  retry: number;
  publish: (identity: string, value?: Preview) => void;
}) {
  const state = rpc.sources.exportRevision.useQuery({
    sourceId: image.sourceId,
    revision: BigInt(image.revision)
  });
  const failed = state.isError;
  const refresh = state.retry;
  const previousRetry = useRef(retry);

  useEffect(() => {
    if (previousRetry.current === retry) return;

    previousRetry.current = retry;

    if (failed) refresh();
  }, [retry, failed, refresh]);
  useEffect(() => {
    const value = state.data;

    if (state.error) {
      publish(identity, { error: state.error });

      return () => publish(identity);
    }

    if (!value) return;

    if (
      value.sourceId !== image.sourceId ||
      value.revision !== BigInt(image.revision) ||
      !value.mime.startsWith('image/')
    ) {
      publish(identity, {
        error: new StudyError('invalid_input', 'Canonical image revision is not an image')
      });

      return () => publish(identity);
    }

    const url = URL.createObjectURL(new Blob([new Uint8Array(value.bytes)], { type: value.mime }));

    publish(identity, { url });

    return () => {
      URL.revokeObjectURL(url);
      publish(identity);
    };
  }, [state.data, state.error, identity, image.sourceId, image.revision, publish]);

  return null;
}

export function useDocumentEditorImages(document: EditableDocument, snapshotId: ContentSnapshotId) {
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [retry, setRetry] = useState(0);
  const publish = useCallback(
    (identity: string, value?: Preview) =>
      setPreviews((current) => {
        const next = { ...current };

        if (value) next[identity] = value;
        else delete next[identity];

        return next;
      }),
    []
  );
  const references = document.blocks.flatMap((block) =>
    block.content.type === 'image' ? [block.content] : []
  );
  const identities = new Set(references.map((image) => `${image.sourceId}:${image.revision}`));
  const active = Object.entries(previews).filter(([identity]) => identities.has(identity));

  return {
    subscriptions: references.map((image) => (
      <ImageSubscription
        key={`${snapshotId}:${image.sourceId}:${image.revision}`}
        retry={retry}
        identity={`${image.sourceId}:${image.revision}`}
        image={image}
        publish={publish}
      />
    )),
    urls: Object.fromEntries(
      active.flatMap(([identity, preview]) => (preview.url ? [[identity, preview.url]] : []))
    ),
    error: active.find(([, value]) => value.error)?.[1].error,
    retry: () => setRetry((value) => value + 1)
  };
}
