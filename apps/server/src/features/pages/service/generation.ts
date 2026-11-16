/** @file Owns generation within this feature. */

import type * as e from '@study/contracts';

import { PagesStore } from '#server/features/pages/store/index';
import { publicationTransaction } from '#server/platform/definitions/define-store';

export function pageGenerationOperations() {
  return {
    createGenerated: (v: typeof e.createGeneratedSchema.Type) =>
      publicationTransaction((tx) => tx.store(PagesStore).createGenerated(v)),
    publishGenerated: (v: typeof e.publishSchema.Type) =>
      publicationTransaction((tx) => tx.store(PagesStore).publishGenerated(v))
  };
}
