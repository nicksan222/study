/** @file Process boundary keeps blocking native inference and native failures out of the RPC server. */
import { StudyError, dictationInputSchema } from '@study/contracts';
import { Schema } from 'effect';

import { transcribeNative } from './native.ts';

const inputSchema = Schema.Struct({
  ...dictationInputSchema.fields,
  modelPath: Schema.String,
  vadPath: Schema.String,
  filterSilence: Schema.Boolean
});

try {
  const input = Schema.decodeUnknownSync(inputSchema)(await Bun.stdin.json());
  const text = transcribeNative(
    input.modelPath,
    input.vadPath,
    Float32Array.from(input.samples, (sample) => sample / 32768),
    input.filterSilence
  );

  await Bun.write(Bun.stdout, JSON.stringify({ text }));
} catch (cause) {
  const kind = cause instanceof StudyError ? cause.kind : 'model_unavailable';

  await Bun.write(Bun.stdout, JSON.stringify({ kind }));
  process.exitCode = 1;
}
