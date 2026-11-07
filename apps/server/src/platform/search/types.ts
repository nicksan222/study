/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Provides typed semantic search infrastructure for local retrieval.                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps search inputs validated and retrieval results bounded.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses injected capabilities without registering agents or application runtime services.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { ProjectId } from '@study/contracts/ids';

export type { EmbeddingModel } from '#server/platform/ai/embeddings/types';

/** The trusted caller supplies scope, never a model-authored tool argument. */
export type SearchScope =
  | { readonly type: 'all' }
  | { readonly type: 'projects'; readonly projectIds: readonly ProjectId[] };
