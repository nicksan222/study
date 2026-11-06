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

import type { StudyError } from '@study/contracts/errors';
import type { ProjectId } from '@study/contracts/ids';
import type { Effect } from 'effect';

export interface EmbeddingModel {
  readonly chunkPassages: (text: string) => Effect.Effect<readonly string[], StudyError>;
  readonly identity: string;
  readonly dimensions: number;
  readonly embedQuery: (text: string) => Effect.Effect<Float32Array, StudyError>;
  readonly embedPassages: (
    texts: readonly string[]
  ) => Effect.Effect<readonly Float32Array[], StudyError>;
}

/** The trusted caller supplies scope, never a model-authored tool argument. */
export type SearchScope =
  | { readonly type: 'all' }
  | { readonly type: 'projects'; readonly projectIds: readonly ProjectId[] };
