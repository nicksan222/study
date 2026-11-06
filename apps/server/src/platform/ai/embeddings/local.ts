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

import { embeddingModel, validateEmbeddingModel } from './model.ts';

export interface LocalEmbeddingModel {
  readonly identity: string;
  readonly dimensions: number;
  readonly chunkPassages: (text: string) => Effect.Effect<readonly string[], StudyError>;
  readonly embedQuery: (text: string) => Effect.Effect<Float32Array, StudyError>;
  readonly embedPassages: (
    texts: readonly string[]
  ) => Effect.Effect<readonly Float32Array[], StudyError>;
}

const readyMessage = Schema.is(Schema.Struct({ ready: Schema.Literal(true) }));

const passageMessage = Schema.is(Schema.Struct({ passages: Schema.Array(Schema.String) }));

const workerError = Schema.is(
  Schema.Struct({ error: Schema.Literals(['invalid_input', 'internal']) })
);

const vectorMessage = Schema.is(
  Schema.Struct({
    vectors: Schema.instanceOf(Float32Array),
    count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16 }))
  })
);

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
    let closed = false;
    let busy = false;
    let pending:
      | {
          resolve: (message: unknown) => void;
          reject: (error: StudyError) => void;
        }
      | undefined;
    let readyResolve: (() => void) | undefined;
    let readyReject: ((error: StudyError) => void) | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });

    const fail = (cause: unknown) => {
      closed = true;
      const error = new StudyError('model_unavailable', 'Local embedding worker is unavailable', {
        cause
      });

      readyReject?.(error);
      readyReject = undefined;
      pending?.reject(error);
      pending = undefined;
      busy = false;
    };

    worker.on('error', fail);
    worker.on('exit', (code) => fail(new Error(`Embedding worker exited (${code})`)));
    worker.on('message', (message: unknown) => {
      if (readyMessage(message)) {
        readyResolve?.();
        readyResolve = undefined;
        readyReject = undefined;

        return;
      }

      const request = pending;

      pending = undefined;
      busy = false;

      if (!request) return;

      if (workerError(message)) {
        request.reject(
          new StudyError(message.error, 'Local embedding request failed validation or inference')
        );

        return;
      }

      request.resolve(message);
    });
    yield* Effect.tryPromise({
      try: () => ready,
      catch: (cause) =>
        cause instanceof StudyError
          ? cause
          : new StudyError('model_unavailable', 'Local embedding model failed to load', { cause })
    });

    const perform = <A>(input: unknown, decode: (message: unknown) => A) =>
      Effect.tryPromise({
        try: (signal) =>
          new Promise<A>((resolve, reject) => {
            if (closed) {
              reject(new StudyError('model_unavailable', 'Local embedding worker is closed'));

              return;
            }

            if (busy) {
              reject(new StudyError('transient', 'Local embedding worker is busy'));

              return;
            }

            if (signal.aborted) {
              reject(new StudyError('cancelled', 'Embedding request was cancelled'));

              return;
            }

            busy = true;
            const abort = () =>
              reject(new StudyError('cancelled', 'Embedding request was cancelled'));
            const cleanup = () => signal.removeEventListener('abort', abort);

            pending = {
              resolve: (message) => {
                cleanup();

                try {
                  resolve(decode(message));
                } catch (cause) {
                  reject(cause);
                }
              },
              reject: (error) => {
                cleanup();
                reject(error);
              }
            };
            signal.addEventListener('abort', abort, { once: true });
            worker.postMessage(input);
          }),
        catch: (cause) =>
          cause instanceof StudyError
            ? cause
            : new StudyError('internal', 'Local embedding generation failed', { cause })
      });

    const embed = (texts: readonly string[], prefix: 'query' | 'passage') => {
      if (texts.length > 16 || texts.some((text) => !text.trim() || text.length > 32000))
        return Effect.fail(
          new StudyError(
            'invalid_input',
            'Embedding input must contain at most sixteen nonempty bounded texts'
          )
        );

      if (!texts.length) return Effect.succeed([]);

      return perform(
        texts.map((text) => `${prefix}: ${text}`),
        (message) => {
          const vectors = readVectors(message, texts.length);

          if (!vectors)
            throw new StudyError('internal', 'Local embedding worker returned invalid vectors');

          return vectors;
        }
      );
    };

    const chunkPassages = (text: string) => {
      if (text.length > 2000000)
        return Effect.fail(
          new StudyError('invalid_input', 'Passage chunking input exceeds its size bound')
        );

      return perform({ operation: 'chunk', text }, (message) => {
        if (!passageMessage(message))
          throw new StudyError('internal', 'Local embedding worker returned invalid passages');

        return message.passages;
      });
    };

    return {
      identity: embeddingModel.identity,
      dimensions: embeddingModel.dimensions,
      chunkPassages,
      embedQuery: (text: string) =>
        embed([text], 'query').pipe(Effect.map((vectors) => vectors[0]!)),
      embedPassages: (texts: readonly string[]) => embed(texts, 'passage')
    } satisfies LocalEmbeddingModel;
  });
}

export const LocalEmbeddings = { open };
