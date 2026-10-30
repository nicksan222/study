import { Worker } from 'node:worker_threads';

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
          try: () => new Worker(new URL('./worker.ts', import.meta.url), { workerData: source }),
          catch: (cause) => new StudyError('internal', 'Diagram validation failed', { cause })
        }),
        (worker) =>
          Effect.tryPromise({
            try: () => worker.terminate(),
            catch: (cause) =>
              new StudyError('internal', 'Diagram worker termination failed', { cause })
          }).pipe(Effect.orDie, Effect.asVoid)
      );

      return yield* Effect.tryPromise({
        try: (signal) =>
          new Promise<string | undefined>((resolve, reject) => {
            const abort = () => reject(signal.reason);

            signal.addEventListener('abort', abort, { once: true });
            worker.once('message', (issue: string | undefined) => {
              signal.removeEventListener('abort', abort);
              resolve(issue?.slice(0, 1000));
            });
            worker.once('error', reject);
            worker.once('exit', (code) => reject(new Error(`Diagram validator exited (${code})`)));

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
