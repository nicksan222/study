import { StudyError } from '@study/contracts/errors';
import type { ContentSnapshotId } from '@study/contracts/ids';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { queryOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

type Image = Extract<(typeof documentSchema.Type.blocks)[number]['content'], { type: 'image' }>;

export const retainedImageOptions = (
  snapshotId: ContentSnapshotId,
  blockId: string,
  image: Image
) =>
  queryOptions({
    queryKey: [
      'sources',
      'image',
      String(snapshotId),
      blockId,
      String(image.sourceId),
      image.revision
    ],
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const value = await request(
        (rpc) =>
          rpc['sources.exportRevision']({
            sourceId: image.sourceId,
            revision: BigInt(image.revision)
          }),
        signal
      );

      if (
        value.sourceId !== image.sourceId ||
        value.revision !== BigInt(image.revision) ||
        !value.mime.startsWith('image/')
      )
        throw new StudyError('invalid_input', 'Canonical image revision is not an image');

      return value;
    }
  });
