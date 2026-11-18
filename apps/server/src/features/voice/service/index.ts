/** @file Owns explicit speech installation, exclusion between model operations and cancellable dictation. */
import { BunFileSystem } from '@effect/platform-bun';
import { StudyError, dictationInputSchema, voiceInstallationIdSchema } from '@study/contracts';
import type { VoiceInstallationId } from '@study/contracts';
import { VoiceModels, VoiceRuntime, defineService, normalizeError } from '@study/server';
import { Effect, FileSystem, Schema } from 'effect';

import { Settings } from '#server/features/settings/index';

import {
  selectSpeechRecognitionStrategy,
  speechModelDirectory,
  speechRecognitionStrategies
} from './strategy.ts';

export const Voice = defineService('study/Voice', function* () {
  const settings = yield* Settings;
  const runtime = yield* VoiceRuntime;
  const fs = yield* FileSystem.FileSystem.pipe(Effect.provide(BunFileSystem.layer));
  const strategy = yield* Effect.try({
    try: () => selectSpeechRecognitionStrategy(runtime.modelId),
    catch: normalizeError
  });

  if (runtime.assets && !runtime.transcribe)
    return yield* Effect.fail(
      new StudyError('invalid_input', 'Speech asset overrides require a recognition adapter')
    );

  const models = new VoiceModels(
    speechModelDirectory(runtime.directory ?? '', strategy),
    fs,
    runtime.assets ?? strategy.assets,
    runtime.fetch
  );
  const shutdown = new AbortController();
  let active: 'installing' | 'removing' | 'transcribing' | undefined;
  let installation:
    | { id: VoiceInstallationId; controller: AbortController; finished: Promise<void> }
    | undefined;
  let inference: Promise<{ text: string }> | undefined;
  let removal: Promise<void> | undefined;
  const available = !runtime.directory
    ? Effect.fail(
        new StudyError('unsupported', 'Local dictation needs a persistent application directory')
      )
    : Effect.void;
  const cancelInstall = (installationId?: VoiceInstallationId) =>
    Effect.suspend(() => {
      const current = installation;

      if (!current || (installationId !== undefined && current.id !== installationId))
        return Effect.void;

      current.controller.abort();

      return Effect.tryPromise({ try: () => current.finished, catch: normalizeError }).pipe(
        Effect.andThen(
          Effect.fail(new StudyError('invalid_input', 'Speech model is already installed'))
        ),
        Effect.catchIf(
          (error) => error.kind === 'cancelled',
          () => Effect.void
        )
      );
    });
  const settleInstall = cancelInstall().pipe(Effect.exit, Effect.asVoid);

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
      Effect.andThen(settleInstall),
      Effect.andThen(awaitInference),
      Effect.andThen(awaitRemoval)
    )
  );
  const install = Effect.tryPromise({
    try: (signal) => {
      const id = voiceInstallationIdSchema.make(crypto.randomUUID());
      const controller = new AbortController();
      const cancellation = AbortSignal.any([signal, controller.signal, shutdown.signal]);
      const finished = models.install(cancellation);

      installation = { id, controller, finished };

      return finished;
    },
    catch: normalizeError
  }).pipe(
    Effect.onInterrupt(() => settleInstall),
    Effect.ensuring(
      Effect.sync(() => {
        installation = undefined;
      })
    ),
    Effect.as({})
  );

  const status = Effect.gen(function* () {
    const current = installation;
    const snapshot = yield* Effect.tryPromise({
      try: () => models.status(),
      catch: normalizeError
    });

    if (snapshot.state === 'downloading' && current && installation === current)
      return { ...snapshot, installationId: current.id };

    return snapshot;
  });

  return {
    status: () =>
      available.pipe(
        Effect.andThen(status),
        Effect.map((status) => ({
          ...status,
          modelId: strategy.model.id,
          models: speechRecognitionStrategies.map(({ model }) => model)
        }))
      ),
    install: () => exclusive('installing', install),
    cancelInstall: (installationId: VoiceInstallationId) =>
      cancelInstall(installationId).pipe(Effect.as({})),
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
              inference = (runtime.transcribe ?? strategy.recognize)(
                {
                  ...decoded,
                  assetPath: (index) => models.path(index),
                  filterSilence: preferences.filterSilence,
                  denoise: preferences.denoise ?? false
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
