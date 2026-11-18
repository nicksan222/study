/** @file Process boundary keeps blocking native inference and native failures out of the RPC server. */
import { StudyError, dictationInputSchema } from '@study/contracts';
import { Schema } from 'effect';

import { denoisePcm } from './denoise.ts';
import { probeNative, transcribeNative } from './native.ts';

const inputSchema = Schema.Struct({
  ...dictationInputSchema.fields,
  modelPath: Schema.String,
  vadPath: Schema.String,
  filterSilence: Schema.Boolean,
  denoise: Schema.optional(Schema.Boolean)
});

try {
  const probe = process.argv.length === 3 && process.argv[2] === '--probe';

  if (process.argv.length > 2 && !probe)
    throw new StudyError('invalid_input', 'Invalid speech worker arguments');

  if (probe) {
    probeNative();
    await denoisePcm(new Float32Array(1));
    await Bun.write(Bun.stdout, JSON.stringify({ initialized: true }));
  } else {
    const input = Schema.decodeUnknownSync(inputSchema)(await Bun.stdin.json());
    const pcm = Float32Array.from(input.samples, (sample) => sample / 32768);
    const text = transcribeNative(
      input.modelPath,
      input.vadPath,
      input.denoise ? await denoisePcm(pcm) : pcm,
      input.filterSilence
    );

    await Bun.write(Bun.stdout, JSON.stringify({ text }));
  }
} catch (cause) {
  const kind = cause instanceof StudyError ? cause.kind : 'model_unavailable';

  await Bun.write(Bun.stdout, JSON.stringify({ kind }));
  process.exitCode = 1;
}
