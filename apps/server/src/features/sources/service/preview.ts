/** @file Reads a CSV or TSV original within the table preview budget. */

import { isDelimitedSource } from '@study/contracts';
import type { SourceId, SourcePreview } from '@study/contracts';
import { transaction } from '@study/server';
import { Effect } from 'effect';

import { delimitedPreview } from '#server/features/sources/decoders/attachment-preview';
import { SourceExportStore, SourceStore } from '#server/features/sources/store/index';

const maxPreviewBytes = 2n * 1024n * 1024n;

export const previewSource = Effect.fnUntraced(function* (id: SourceId) {
  const input = yield* transaction((tx) => {
    const source = tx.store(SourceStore).source(id);

    if (!isDelimitedSource(source)) return { kind: 'unavailable', reason: 'unsupported' } as const;

    if (source.sizeBytes > maxPreviewBytes) return { kind: 'unavailable', reason: 'size' } as const;

    const { bytes } = tx.store(SourceExportStore).sourceExport(id);

    return { kind: 'ready', mime: source.mime, bytes } as const;
  });

  return input.kind === 'unavailable'
    ? (input satisfies SourcePreview)
    : delimitedPreview(input.bytes, input.mime);
});
