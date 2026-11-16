/** @file Owns library within this feature. */

import type { exportPageInputSchema } from '@study/contracts';

import {
  PageComparisonsStore,
  PageDeletionStore,
  PageExportsStore,
  PageHistoryStore,
  PageVersionsStore,
  PagesStore
} from '#server/features/pages/store/index';
import { transaction, useStore } from '#server/platform/definitions/define-store';

import { serializePageVersion } from './export-serializer.ts';

export function* pageLibraryOperations() {
  const docs = yield* useStore(PagesStore);

  const versions = yield* useStore(PageVersionsStore);

  const comparisons = yield* useStore(PageComparisonsStore);

  const exports = yield* useStore(PageExportsStore);

  const history = yield* useStore(PageHistoryStore);

  const deletion = yield* useStore(PageDeletionStore);

  return {
    ...docs,
    count: docs.count,
    ...versions,
    ...exports,
    exportFile: (v: typeof exportPageInputSchema.Type) =>
      transaction((tx) =>
        serializePageVersion(tx.store(PageVersionsStore).version({ id: v.id }), v.format)
      ),
    ...history,
    ...deletion,
    compare: comparisons.comparison
  };
}
