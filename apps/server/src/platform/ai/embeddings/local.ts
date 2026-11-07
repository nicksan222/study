/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Owns a scoped offline embedding worker and validates bounded inference requests.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exposes typed query and passage embedding effects with cancellation and cleanup.       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature services provide content; this module owns inference without database access.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';

import { StudyError } from '@study/contracts/errors';
import { Effect, Schema } from 'effect';

import { embeddingLimits } from './limits.ts';
import { embeddingModel, validateEmbeddingModel } from './model.ts';
import type { EmbeddingModel } from './types.ts';
import { makeWorkerClient } from './worker-client.ts';

export type LocalEmbeddingModel = EmbeddingModel;

const passageMessage = Schema.is(Schema.Struct({ passages: Schema.Array(Schema.String) }));

const vectorMessage = Schema.is(
  Schema.Struct({
    vectors: Schema.instanceOf(Float32Array),
    count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: embeddingLimits.batchSize }))
  })
);

/** Validate the worker’s response dimensions and finite values before exposing copied vectors. */
function readVectors(message: unknown, expectedCount: number): readonly Float32Array[] | undefined {
  if (!vectorMessage(message)) return undefined;

  const { vectors, count } = message;

  if (
    count !== expectedCount ||
    vectors.length !== count * embeddingModel.dimensions ||
    !vectors.every(Number.isFinite)
  )
    return undefined;

  return Array.from({ length: count }, (_, index) =>
    vectors.slice(index * embeddingModel.dimensions, (index + 1) * embeddingModel.dimensions)
  );
}

/** Open a local-only embedding worker whose lifetime belongs to the caller's Effect scope. */
function open(directory: string) {
  return Effect.gen(function* () {
    yield* validateEmbeddingModel(directory);
    const worker = yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          new Worker(new URL('./worker.ts', import.meta.url), {
            workerData: resolve(directory),
            execArgv: []
          }),
        catch: (cause) =>
          new StudyError('model_unavailable', 'Local embedding worker could not start', { cause })
      }),
      (worker) =>
        Effect.tryPromise({
          try: () => worker.terminate(),
          catch: (cause) =>
            new StudyError('internal', 'Local embedding worker termination failed', { cause })
        }).pipe(Effect.orDie, Effect.asVoid)
    );
    const client = makeWorkerClient(worker);

    yield* client.ready;

    /** Validate bounded nonempty inputs and apply the model’s distinct query or passage prefix. */
    const embed = (texts: readonly string[], prefix: 'query' | 'passage') => {
      if (
        texts.length > embeddingLimits.batchSize ||
        texts.some((text) => !text.trim() || text.length > embeddingLimits.embeddingInputLength)
      )
        return Effect.fail(
          new StudyError(
            'invalid_input',
            'Embedding input must contain at most sixteen nonempty bounded texts'
          )
        );

      if (!texts.length) return Effect.succeed([]);

      return client.perform(
        { operation: prefix, texts: texts.map((text) => `${prefix}: ${text}`) },
        (message) => {
          const vectors = readVectors(message, texts.length);

          if (!vectors)
            throw new StudyError('internal', 'Local embedding worker returned invalid vectors');

          return vectors;
        }
      );
    };

    /** Reject oversized worker messages and validate the returned original-text excerpts. */
    const chunkPassages = (text: string) => {
      if (text.length > embeddingModel.maxChunkingInputLength)
        return Effect.fail(
          new StudyError('invalid_input', 'Passage chunking input exceeds its size bound')
        );

      return client.perform({ operation: 'chunk', text }, (message) => {
        if (!passageMessage(message))
          throw new StudyError('internal', 'Local embedding worker returned invalid passages');

        return message.passages;
      });
    };

    return {
      identity: embeddingModel.identity,
      dimensions: embeddingModel.dimensions,
      maxChunkingInputLength: embeddingModel.maxChunkingInputLength,
      chunkPassages,
      embedQuery: (text: string) =>
        embed([text], 'query').pipe(Effect.map((vectors) => vectors[0]!)),
      embedPassages: (texts: readonly string[]) => embed(texts, 'passage')
    } satisfies LocalEmbeddingModel;
  });
}

export const LocalEmbeddings = { open };
