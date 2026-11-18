/** @file Isolated native speech execution and runtime adapters supplied at application composition. */
import { StudyError, errorKindSchema } from '@study/contracts';
import { Context, Schema } from 'effect';

import type { SpeechAsset } from './models.ts';

export interface SpeechInput {
  readonly samples: readonly number[];
  readonly modelPath: string;
  readonly vadPath: string;
  readonly filterSilence: boolean;
  readonly denoise?: boolean;
}

export interface VoiceRecognitionInput {
  readonly samples: readonly number[];
  readonly assetPath: (index: number) => string;
  readonly filterSilence: boolean;
  readonly denoise: boolean;
}

export interface VoiceRuntimeAdapters {
  readonly modelId?: string;
  readonly assets?: readonly SpeechAsset[];
  readonly fetch?: (url: string, options?: RequestInit) => Promise<Response>;
  readonly transcribe?: (
    input: VoiceRecognitionInput,
    signal: AbortSignal
  ) => Promise<{ text: string }>;
}

export class VoiceRuntime extends Context.Service<
  VoiceRuntime,
  VoiceRuntimeAdapters & { readonly directory: string | undefined }
>()('study/VoiceRuntime') {}

const workerResult = Schema.Union([
  Schema.Struct({ text: Schema.String }),
  Schema.Struct({ kind: errorKindSchema })
]);

export async function transcribeInProcess(
  input: SpeechInput,
  cancellation: AbortSignal
): Promise<{ text: string }> {
  const child = Bun.spawn(
    [process.execPath, Bun.fileURLToPath(new URL('./worker.ts', import.meta.url))],
    {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore'
    }
  );
  const stop = () => child.kill('SIGKILL');

  cancellation.addEventListener('abort', stop, { once: true });

  try {
    cancellation.throwIfAborted();
    child.stdin.write(
      JSON.stringify({
        ...input
      })
    );
    await child.stdin.end();
    const output = await new Response(child.stdout).text();
    const exit = await child.exited;

    if (cancellation.aborted) throw new StudyError('cancelled', 'Dictation was cancelled');

    if (!output)
      throw new StudyError(
        'model_unavailable',
        'Speech recognition process exited without a result'
      );

    const result = Schema.decodeUnknownSync(workerResult)(JSON.parse(output));

    if ('kind' in result) throw new StudyError(result.kind, 'Speech recognition failed');

    if (exit !== 0) throw new StudyError('model_unavailable', 'Speech recognition process failed');

    return result;
  } catch (cause) {
    if (cancellation.aborted) throw new StudyError('cancelled', 'Dictation was cancelled');

    throw cause;
  } finally {
    cancellation.removeEventListener('abort', stop);
    child.kill();
    await child.exited;
  }
}
