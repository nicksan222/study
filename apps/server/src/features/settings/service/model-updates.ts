/** @file Records newly used model versions and acknowledges durable notices. */
import type { ModelUpdate } from '@study/contracts';
import { compareModelReleases, transaction, useStore } from '@study/server';
import type { ModelRelease } from '@study/server';
import { Effect, Option } from 'effect';

import { ModelUpdatesStore } from '#server/features/settings/store/model-updates';

export function* modelUpdateOperations() {
  const store = yield* useStore(ModelUpdatesStore);

  return {
    modelUpdates: () => store.pending(undefined),
    observeModelRelease: Effect.fnUntraced(function* (release: ModelRelease) {
      const current = yield* store.state(release);

      if (
        Option.exists(current, ({ release: latest }) => compareModelReleases(release, latest) <= 0)
      )
        return;

      yield* transaction((tx) => {
        const records = tx.store(ModelUpdatesStore);
        const previous = Option.getOrUndefined(records.state(release));

        if (previous && compareModelReleases(release, previous.release) <= 0) return;

        const pending =
          previous && previous.release.model !== release.model
            ? {
                provider: release.provider,
                family: release.family,
                previousModel: previous.pending?.previousModel ?? previous.release.model,
                model: release.model
              }
            : previous?.pending;

        records.save(pending ? { release, pending } : { release });
      });
    }),
    dismissModelUpdate: (notice: ModelUpdate) =>
      transaction((tx) => {
        const records = tx.store(ModelUpdatesStore);
        const state = Option.getOrUndefined(records.state(notice));

        if (
          state?.pending?.model === notice.model &&
          state.pending.previousModel === notice.previousModel
        )
          records.save({ release: state.release });

        return {};
      })
  };
}
