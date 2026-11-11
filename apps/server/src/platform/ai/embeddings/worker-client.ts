/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Serializes bounded requests to a caller-owned local embedding worker.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves native request ownership after caller cancellation.                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The caller creates and terminates the worker; this client owns protocol coordination.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { Effect, Option, Schema, Semaphore } from 'effect';

import { embeddingLimits } from './limits.ts';

const readyMessage = Schema.is(Schema.Struct({ ready: Schema.Literal(true) }));

const workerError = Schema.is(
  Schema.Struct({ error: Schema.Literals(['invalid_input', 'internal']) })
);

/** Serialize worker requests without releasing native ownership when only the caller cancels. */
export function makeWorkerClient(worker: Worker) {
  let closed = false;
  const serial = Semaphore.makeUnsafe(1);
  const capacity = Semaphore.makeUnsafe(embeddingLimits.queuedRequests + 1);
  let idle = Promise.resolve();
  let releaseIdle: (() => void) | undefined;
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

  /** Fail readiness and active work, then wake queued callers to observe worker closure. */
  const fail = (cause: unknown) => {
    closed = true;
    const error = new StudyError('model_unavailable', 'Local embedding worker is unavailable', {
      cause
    });

    readyReject?.(error);
    readyReject = undefined;
    pending?.reject(error);
    pending = undefined;
    releaseIdle?.();
    releaseIdle = undefined;
  };

  worker.addEventListener('error', (event) => fail(event.error ?? new Error(event.message)));
  worker.addEventListener('close', (event) =>
    fail(new Error(`Embedding worker exited (${(event as CloseEvent).code})`))
  );
  worker.addEventListener('message', (event: MessageEvent<unknown>) => {
    const message = event.data;

    if (readyMessage(message)) {
      readyResolve?.();
      readyResolve = undefined;
      readyReject = undefined;

      return;
    }

    const request = pending;

    pending = undefined;
    releaseIdle?.();
    releaseIdle = undefined;

    if (!request) return;

    if (workerError(message)) {
      request.reject(
        new StudyError(message.error, 'Local embedding request failed validation or inference')
      );

      return;
    }

    request.resolve(message);
  });
  const readyEffect = Effect.tryPromise({
    try: () => ready,
    catch: (cause) =>
      cause instanceof StudyError
        ? cause
        : new StudyError('model_unavailable', 'Local embedding model failed to load', { cause })
  });

  /** Admit a bounded caller and retain its native reply slot after Effect interruption. */
  const perform = <A>(input: unknown, decode: (message: unknown) => A) =>
    capacity
      .withPermitsIfAvailable(1)(
        serial.withPermit(
          Effect.tryPromise({
            try: async (signal) => {
              // A cancelled caller releases its queue permit, but native work owns this boundary
              // until its response arrives. New callers wait instead of racing the old response.
              await idle;

              if (closed)
                throw new StudyError('model_unavailable', 'Local embedding worker is closed');

              if (signal.aborted)
                throw new StudyError('cancelled', 'Embedding request was cancelled');

              return new Promise<A>((resolve, reject) => {
                idle = new Promise<void>((resolveIdle) => {
                  releaseIdle = resolveIdle;
                });
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

                try {
                  worker.postMessage(input);
                } catch (cause) {
                  fail(cause);
                }
              });
            },
            catch: (cause) =>
              cause instanceof StudyError
                ? cause
                : new StudyError('internal', 'Local embedding generation failed', { cause })
          })
        )
      )
      .pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(new StudyError('rate_limited', 'Local embedding request queue is full')),
            onSome: Effect.succeed
          })
        )
      );

  return { ready: readyEffect, perform };
}
