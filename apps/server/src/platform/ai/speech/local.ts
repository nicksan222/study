/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Bounds local speech memory and owns worker termination, including cancellation.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates typed inputs and preserves explicit operation ownership.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps application policy outside shared inference and persistence mechanisms.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Worker } from 'node:worker_threads';

import { StudyError } from '@study/contracts/errors';
import { Effect, Schema, Semaphore } from 'effect';

import { validateModelAssets } from '#server/platform/ai/model-assets';

import { vozModel } from './model.ts';
import { transcriptSchema } from './protocol.ts';

const capacity = Semaphore.makeUnsafe(1);

export const transcribeAudio = (directory: string, bytes: Uint8Array) =>
  capacity.withPermit(
    Effect.scoped(
      Effect.gen(function* () {
        yield* validateModelAssets(directory, vozModel);
        const worker = yield* Effect.acquireRelease(
          Effect.try({
            try: () =>
              new Worker(new URL('./worker.ts', import.meta.url), {
                workerData: { directory, bytes },
                execArgv: []
              }),
            catch: (cause) =>
              new StudyError('model_unavailable', 'Speech worker could not start', { cause })
          }),
          (worker) =>
            Effect.tryPromise({
              try: async () => {
                await worker.terminate();
              },
              catch: (cause) =>
                new StudyError('internal', 'Speech worker termination failed', { cause })
            }).pipe(Effect.orDie)
        );

        return yield* Effect.tryPromise({
          try: (signal) =>
            new Promise<typeof transcriptSchema.Type>((resolve, reject) => {
              let settled = false;
              const finish = (error?: unknown, value?: unknown) => {
                if (settled) return;

                settled = true;
                signal.removeEventListener('abort', abort);

                if (error) reject(error);
                else {
                  try {
                    resolve(Schema.decodeUnknownSync(transcriptSchema)(value));
                  } catch (cause) {
                    reject(cause);
                  }
                }
              };
              const abort = () => finish(new StudyError('cancelled', 'Transcription cancelled'));

              worker.once('message', (value: unknown) => finish(undefined, value));
              worker.once('error', finish);
              worker.once('exit', (code) => finish(new Error(`Speech worker exited (${code})`)));
              signal.addEventListener('abort', abort, { once: true });

              if (signal.aborted) abort();
            }),
          catch: (cause) =>
            cause instanceof StudyError
              ? cause
              : new StudyError('model_unavailable', 'Local transcription failed', { cause })
        });
      })
    )
  );
