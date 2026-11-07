/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines the shared local embedding capability used by semantic retrieval.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps provider implementations and search consumers on one capability shape.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Describes offline inference without database access or runtime registration.             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { StudyError } from '@study/contracts/errors';
import type { Effect } from 'effect';

export interface EmbeddingModel {
  readonly maxChunkingInputLength: number;
  readonly chunkPassages: (text: string) => Effect.Effect<readonly string[], StudyError>;
  readonly identity: string;
  readonly dimensions: number;
  readonly embedQuery: (text: string) => Effect.Effect<Float32Array, StudyError>;
  readonly embedPassages: (
    texts: readonly string[]
  ) => Effect.Effect<readonly Float32Array[], StudyError>;
}
