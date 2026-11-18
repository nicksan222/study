/** Explicitly provisions the native test matrix with integrity-checked production model assets. */
import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { VoiceModels } from '@study/server';
import { speechRecognitionStrategies } from '@study/server/testing';
import { Effect, FileSystem, Layer, Path } from 'effect';

const directory = process.env.STUDY_VOICE_MODELS_DIR;

if (!directory) throw new Error('Set STUDY_VOICE_MODELS_DIR to the recognition fixture cache.');

await Effect.runPromise(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    for (const { model, assets } of speechRecognitionStrategies) {
      const files = new VoiceModels(path.join(directory, model.id), fs, assets);

      yield* Effect.tryPromise({
        try: (signal) => files.install(signal),
        catch: (cause) => new Error(`Could not prepare speech fixtures for ${model.id}`, { cause })
      });
    }
  }).pipe(Effect.provide(Layer.merge(BunFileSystem.layer, BunPath.layer)))
);
