/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates constrained Mermaid flowcharts in a short-lived worker thread. The       │
 * │ Effect wrapper bounds execution time and ensures worker termination on completion or     │
 * │ interruption.                                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports diagramFeedback. It rejects unsupported directives before starting a Worker,   │
 * │   applies a ten-second timeout, and terminates the worker in the Effect scope finalizer. │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The diagram feature calls diagramFeedback with generated Mermaid source; this module     │
 * │ delegates parsing to diagram/worker.ts.                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { Effect } from 'effect';

/** Parse isolated Mermaid with a bounded worker lifetime. */
export const diagramFeedback = (source: string) => {
  if (
    !/^\s*(?:flowchart|graph)\s+(?:TD|LR)\b/i.test(source) ||
    /(?:^|[;\n])\s*(?:click|style|classDef|class|linkStyle)\b/i.test(source) ||
    /%%\{|<script\b|:::/i.test(source)
  )
    return Effect.succeed(
      'Use a flowchart TD or LR without directives, styles, or click handlers.'
    );

  return Effect.scoped(
    Effect.gen(function* () {
      const worker = yield* Effect.acquireRelease(
        Effect.try({
          try: () => new Worker(new URL('./worker.ts', import.meta.url)),
          catch: (cause) => new StudyError('internal', 'Diagram validation failed', { cause })
        }),
        (worker) => Effect.sync(() => worker.terminate())
      );

      return yield* Effect.tryPromise({
        try: (signal) =>
          new Promise<string | undefined>((resolve, reject) => {
            const abort = () => reject(signal.reason);

            signal.addEventListener('abort', abort, { once: true });
            worker.onmessage = (event: MessageEvent<string | undefined>) => {
              signal.removeEventListener('abort', abort);
              resolve(event.data?.slice(0, 1000));
            };
            worker.onerror = (event) => reject(event.error ?? new Error(event.message));
            worker.postMessage(source);

            if (signal.aborted) abort();
          }),
        catch: (cause) => new StudyError('internal', 'Diagram validation failed', { cause })
      }).pipe(
        Effect.timeout('10 seconds'),
        Effect.mapError((cause) =>
          cause instanceof StudyError
            ? cause
            : new StudyError('internal', 'Diagram validation timed out', { cause })
        )
      );
    })
  );
};
