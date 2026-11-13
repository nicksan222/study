import { StudyError } from '@study/contracts/errors';
import type { ContentSnapshotId, ProjectId } from '@study/contracts/ids';
import type { revisionExportSchema } from '@study/contracts/sources/rpc';
import { sniff } from '@study/contracts/sources/sniff';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { request } from '#client/lib/study-client/request.ts';

import type { EditableDocument } from './document-editor-content';
import { retainedImageOptions } from './retained-document.queries';

type ImageBytes = typeof revisionExportSchema.Type;

function imageResults(results: UseQueryResult<ImageBytes>[]) {
  return {
    data: results.map((result) => (result.isError ? undefined : result.data)),
    error: results.find((result) => result.isError)?.error
  };
}

/** Resolves immutable image revisions and keeps blob URLs out of durable document content. */
export function useDocumentEditorImages(
  document: EditableDocument,
  snapshotId: ContentSnapshotId,
  projectId?: ProjectId
) {
  const cache = useQueryClient();
  const assets = useQueries({
    queries: document.blocks.flatMap((block) =>
      block.content.type === 'image'
        ? [retainedImageOptions(snapshotId, block.id, block.content)]
        : []
    ),
    combine: imageResults
  });
  const previews = useMemo(() => imagePreviewStore(), []);

  useEffect(() => previews.update(assets.data), [previews, assets.data]);
  const urls = useSyncExternalStore(previews.subscribe, previews.getSnapshot);

  const upload = useCallback(
    async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());

      if (sniff(file.name, bytes).kind !== 'image')
        throw new StudyError('invalid_input', 'The selected file is not an image');

      const source = await request((rpc) =>
        rpc['sources.createSource']({ name: file.name, bytes, projectId: projectId ?? null })
      );

      if (source.kind !== 'image')
        throw new StudyError('invalid_input', 'The retained source is not an image');

      void cache.invalidateQueries({ queryKey: ['sources'] });

      return { sourceId: String(source.id), revision: 1, alt: source.name };
    },
    [cache, projectId]
  );

  return {
    urls,
    upload,
    error: assets.error,
    retry: () =>
      void cache.invalidateQueries({
        queryKey: ['sources', 'image'],
        predicate: (query) => query.state.status === 'error'
      })
  };
}

function imagePreviewStore() {
  let urls: Record<string, string> = {};
  const retained = new Map<ImageBytes, string>();
  let notify = () => {};

  return {
    getSnapshot: () => urls,
    subscribe: (listener: () => void) => {
      notify = listener;

      return () => {
        retained.forEach((url) => URL.revokeObjectURL(url));
        retained.clear();
        urls = {};
      };
    },
    update: (images: (ImageBytes | undefined)[]) => {
      for (const [image, url] of retained) {
        if (images.includes(image)) continue;

        URL.revokeObjectURL(url);
        retained.delete(image);
      }

      const next: Record<string, string> = {};

      for (const image of images) {
        if (!image) continue;

        let url = retained.get(image);

        if (!url) {
          url = URL.createObjectURL(new Blob([new Uint8Array(image.bytes)], { type: image.mime }));
          retained.set(image, url);
        }

        next[`${image.sourceId}:${image.revision}`] = url;
      }

      if (JSON.stringify(next) === JSON.stringify(urls)) return;

      urls = next;
      notify();
    }
  };
}
