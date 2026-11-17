/** @file Owns explicit speech installation, exclusion between model operations and cancellable dictation. */
import { BunFileSystem } from '@effect/platform-bun';
import { StudyError, dictationInputSchema } from '@study/contracts';
import { VoiceModels, VoiceRuntime, defineService, normalizeError } from '@study/server';
import { Effect, FileSystem, Schema } from 'effect';

import { Settings } from '#server/features/settings/index';

import { createParakeetStrategy } from './strategy.ts';

export const Voice = defineService('study/Voice', function* () {
  const settings = yield* Settings;
  const runtime = yield* VoiceRuntime;
  const fs = yield* FileSystem.FileSystem.pipe(Effect.provide(BunFileSystem.layer));
  const strategy = createParakeetStrategy(runtime);
  const models = new VoiceModels(runtime.directory ?? '', fs, strategy.assets, runtime.fetch);
  const shutdown = new AbortController();
  let active: 'installing' | 'removing' | 'transcribing' | undefined;
  let installation: { controller: AbortController; finished: Promise<void> } | undefined;
  let inference: Promise<{ text: string }> | undefined;
  let removal: Promise<void> | undefined;
  const available = !runtime.directory
    ? Effect.fail(
        new StudyError('unsupported', 'Local dictation needs a persistent application directory')
      )
    : Effect.void;
  const cancelInstall = Effect.suspend(() => {
    const current = installation;

    if (!current) return Effect.void;

    current.controller.abort();

    return Effect.tryPromise({ try: () => current.finished, catch: normalizeError }).pipe(
      Effect.exit,
      Effect.asVoid
    );
  });

  const awaitInference = Effect.suspend(() =>
    inference
      ? Effect.tryPromise({ try: () => inference!, catch: normalizeError }).pipe(
          Effect.exit,
          Effect.asVoid
        )
      : Effect.void
  );
  const awaitRemoval = Effect.suspend(() =>
    removal
      ? Effect.tryPromise({ try: () => removal!, catch: normalizeError }).pipe(
          Effect.exit,
          Effect.asVoid
        )
      : Effect.void
  );
  const clearInference = Effect.sync(() => {
    inference = undefined;
  });
  const release = Effect.sync(() => {
    active = undefined;
  });

  function exclusive<A, E, R>(kind: NonNullable<typeof active>, work: Effect.Effect<A, E, R>) {
    return Effect.uninterruptibleMask(
      Effect.fnUntraced(function* (restore) {
        yield* available;

        if (active)
          return yield* Effect.fail(new StudyError('invalid_input', 'Speech models are in use'));

        active = kind;

        return yield* restore(work).pipe(Effect.ensuring(release));
      })
    );
  }

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => shutdown.abort()).pipe(
      Effect.andThen(cancelInstall),
      Effect.andThen(awaitInference),
      Effect.andThen(awaitRemoval)
    )
  );
  const install = Effect.tryPromise({
    try: (signal) => {
      const controller = new AbortController();
      const cancellation = AbortSignal.any([signal, controller.signal, shutdown.signal]);
      const finished = models.install(cancellation).catch((cause: unknown) => {
        if (cancellation.aborted)
          throw new StudyError('cancelled', 'Speech model installation was cancelled');

        throw cause;
      });

      installation = { controller, finished };

      return finished;
    },
    catch: normalizeError
  }).pipe(
    Effect.onInterrupt(() => cancelInstall),
    Effect.ensuring(
      Effect.sync(() => {
        installation = undefined;
      })
    ),
    Effect.as({})
  );

  return {
    status: () =>
      available.pipe(
        Effect.andThen(Effect.tryPromise({ try: () => models.status(), catch: normalizeError })),
        Effect.map((status) => ({
          ...status,
          modelId: strategy.id,
          languages: strategy.language.supported,
          languageDetection: strategy.language.detection
        }))
      ),
    install: () => exclusive('installing', install),
    cancelInstall: () => cancelInstall.pipe(Effect.as({})),
    remove: () =>
      exclusive(
        'removing',
        Effect.tryPromise({
          try: () => {
            removal = models.remove();

            return removal;
          },
          catch: normalizeError
        }).pipe(
          Effect.uninterruptible,
          Effect.ensuring(
            Effect.sync(() => {
              removal = undefined;
            })
          ),
          Effect.as({})
        )
      ),
    transcribe: (input: typeof dictationInputSchema.Type) =>
      exclusive(
        'transcribing',
        Effect.gen(function* () {
          const decoded = yield* Effect.try({
            try: () => Schema.decodeUnknownSync(dictationInputSchema)(input),
            catch: () => new StudyError('invalid_input', 'Invalid dictation audio')
          });
          const status = yield* Effect.tryPromise({
            try: () => models.status(),
            catch: normalizeError
          });

          if (status.state !== 'ready')
            return yield* Effect.fail(
              new StudyError('model_unavailable', 'Install speech recognition in Voice settings')
            );

          const preferences = yield* settings.voiceSettings();

          return yield* Effect.tryPromise({
            try: (signal) => {
              inference = strategy.recognize(
                {
                  ...decoded,
                  directory: models.root,
                  filterSilence: preferences.filterSilence
                },
                AbortSignal.any([signal, shutdown.signal])
              );

              return inference;
            },
            catch: normalizeError
          }).pipe(
            Effect.onInterrupt(() => awaitInference),
            Effect.ensuring(clearInference),
            Effect.timeoutOrElse({
              duration: '2 minutes',
              orElse: () => Effect.fail(new StudyError('cancelled', 'Speech recognition timed out'))
            })
          );
        })
      )
  };
});
