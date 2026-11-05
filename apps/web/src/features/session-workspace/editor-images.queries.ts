import { StudyError } from '@study/contracts/errors';
import type { ContentSnapshotId, ProjectId } from '@study/contracts/ids';
import type { revisionExportSchema } from '@study/contracts/sources/rpc';
import { sniff } from '@study/contracts/sources/sniff';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { request } from '#web/lib/study-client/request.ts';

import { retainedImageOptions } from '../document-presentation';
import type { EditableDocument } from './document-editor-content';

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
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};

    for (const image of assets.data) {
      if (!image) continue;

      next[`${image.sourceId}:${image.revision}`] = URL.createObjectURL(
        new Blob([new Uint8Array(image.bytes)], { type: image.mime })
      );
    }

    // Blob URLs are external resources created and revoked with this effect's lifetime.
    // oxlint-disable-next-line react/set-state-in-effect
    setUrls(next);

    return () => {
      Object.values(next).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [assets.data]);

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
    retry: () => void cache.invalidateQueries({ queryKey: ['sources', 'image'] })
  };
}
