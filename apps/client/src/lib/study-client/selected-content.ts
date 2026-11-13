import { StudyError } from '@study/contracts/errors';
import type { ContentSnapshotId, PageId } from '@study/contracts/ids';
import type { selectionReferenceSchema } from '@study/contracts/notes/context';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { Effect } from 'effect';

import { request } from './request';

type SelectedContent = {
  snapshotId: ContentSnapshotId;
  pageId: PageId | null;
  name: string;
  number?: bigint;
  document: typeof documentSchema.Type;
};

const present = (value: SelectedContent): SelectedContent => value;

export function selectedContent(input: typeof selectionReferenceSchema.Type, signal?: AbortSignal) {
  return request(
    (rpc) =>
      input.kind === 'source'
        ? rpc['sources.extraction'](input).pipe(
            Effect.flatMap((value) => {
              if (
                value.sourceId !== input.sourceId ||
                value.revision !== input.revision ||
                value.snapshotId !== input.snapshotId
              )
                return Effect.fail(
                  new StudyError('invalid_input', 'Source extraction identity mismatch')
                );

              return Effect.succeed(present({ ...value, pageId: null }));
            })
          )
        : Effect.gen(function* () {
            const version = yield* rpc['pages.version']({ id: input.versionId });
            const owner = yield* rpc['pages.page']({ id: version.pageId });

            if (
              version.status !== 'published' ||
              version.id !== input.versionId ||
              owner.id !== version.pageId
            )
              return yield* Effect.fail(
                new StudyError('invalid_input', 'Authored version ownership mismatch')
              );

            return present({ ...version, name: owner.title });
          }),
    signal
  );
}
