import { Worker } from 'node:worker_threads';

import type { z } from 'zod';

import type { diagramSchema } from './agents/diagram.ts';
import type { flashcardsSchema } from './agents/flashcards.ts';
import type { StudyAgents } from './agents/index.ts';

export type Material =
  | ({ type: 'flashcards' } & z.infer<typeof flashcardsSchema>)
  | ({ type: 'diagram' } & z.infer<typeof diagramSchema>);

/** Generate and validate material; retry a malformed diagram with parser feedback. */
export async function generateMaterial(
  agents: StudyAgents,
  prompt: string,
  options: {
    signal?: AbortSignal;
    save?: (material: Material, signal?: AbortSignal) => Promise<void>;
    maxAttempts?: number;
    kind: 'flashcards' | 'diagram';
  }
): Promise<Material> {
  const attempts = options.maxAttempts ?? 3;

  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5)
    throw new RangeError('maxAttempts must be between 1 and 5');

  let request = prompt;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const material: Material =
      options.kind === 'diagram'
        ? {
            type: 'diagram',
            ...(
              await agents.diagram.generate({
                prompt: request,
                abortSignal: options.signal
              })
            ).output
          }
        : {
            type: 'flashcards',
            ...(
              await agents.flashcards.generate({
                prompt: request,
                abortSignal: options.signal
              })
            ).output
          };
    const issue =
      material.type === 'diagram'
        ? await diagramFeedback(material.mermaid, options.signal)
        : undefined;

    if (!issue) {
      await options.save?.(material, options.signal);

      return material;
    }

    if (material.type === 'diagram')
      request = `${prompt}\n\nPrevious diagram:\n${material.mermaid}\n\n${issue}`;
  }

  throw new Error('Diagram could not be validated');
}

/** Mermaid uses a DOM internally; keep it and its parser state in a disposable worker. */
async function diagramFeedback(source: string, signal?: AbortSignal): Promise<string | undefined> {
  signal?.throwIfAborted();
  const worker = new Worker(new URL('./validate-diagram.ts', import.meta.url), {
    workerData: source
  });

  try {
    return await new Promise<string | undefined>((resolve, reject) => {
      const abort = () => reject(signal?.reason);
      const cleanup = () => signal?.removeEventListener('abort', abort);

      signal?.addEventListener('abort', abort, { once: true });
      worker.once('message', (issue: string | undefined) => {
        cleanup();
        resolve(issue);
      });
      worker.once('error', (error) => {
        cleanup();
        reject(error);
      });
      worker.once('exit', (code) => {
        cleanup();
        reject(new Error(`Diagram validator exited (${code})`));
      });
    });
  } finally {
    await worker.terminate();
  }
}
