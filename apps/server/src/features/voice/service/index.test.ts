import { VoiceModels } from '@study/server';
import { test } from '@study/testing';
import { CryptoHasher } from 'bun';
import { Effect, Fiber } from 'effect';

import { Settings } from '#server/features/settings/index';
import { Voice } from '#server/features/voice/index';

const bytes = new Uint8Array([1, 2, 3]);

const assets = ['speech.gguf', 'vad.gguf'].map((filename) => ({
  filename,
  url: `https://example.test/${filename}`,
  size: bytes.length,
  sha256: new CryptoHasher('sha256').update(bytes).digest('hex')
}));

test.server.stable(
  'dictation requires explicit installation, serializes inference and uses persisted voice preferences',
  async ({ resources, expect }) => {
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const app = await resources.openApp({
      voice: {
        assets,
        fetch: async () => new Response(bytes),
        transcribe: async (input) => {
          expect(input.filterSilence).toBe(false);
          expect(input.denoise).toBe(true);
          entered.resolve();
          await finish.promise;

          return { text: 'Dettato italiano.' };
        }
      }
    });
    const run = app.nativeRuntime.runPromise.bind(app.nativeRuntime);
    const notInstalled = await run(
      Effect.gen(function* () {
        const voice = yield* Voice;

        return yield* Effect.flip(voice.transcribe({ samples: [0] }));
      })
    );

    expect(notInstalled.kind).toBe('model_unavailable');
    await run(
      Effect.gen(function* () {
        const voice = yield* Voice;
        const settings = yield* Settings;

        yield* settings.saveVoiceSettings({ filterSilence: false, denoise: true });
        yield* voice.install();
      })
    );
    const transcription = run(Voice.use((voice) => voice.transcribe({ samples: [16384] })));

    await entered.promise;

    try {
      expect((await run(Voice.use((voice) => Effect.flip(voice.remove())))).kind).toBe(
        'invalid_input'
      );
      expect(
        (await run(Voice.use((voice) => Effect.flip(voice.transcribe({ samples: [0] }))))).kind
      ).toBe('invalid_input');
    } finally {
      finish.resolve();
    }

    expect(await transcription).toEqual({ text: 'Dettato italiano.' });
    await run(Voice.use((voice) => voice.remove()));
    expect((await run(Voice.use((voice) => voice.status()))).state).toBe('missing');
  }
);

test.server.stable(
  'cancelling dictation waits for native cleanup before allowing model removal',
  async ({ resources, expect }) => {
    const entered = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    const app = await resources.openApp({
      voice: {
        assets,
        fetch: async () => new Response(bytes),
        transcribe: async (_input, signal) => {
          signal.addEventListener('abort', () => aborted.resolve(), { once: true });
          entered.resolve();
          await cleanup.promise;

          return { text: 'discarded' };
        }
      }
    });

    await app.nativeRuntime.runPromise(
      Effect.gen(function* () {
        const voice = yield* Voice;

        yield* voice.install();
        const task = yield* Effect.forkChild(voice.transcribe({ samples: [0] }));

        yield* Effect.promise(() => entered.promise);
        const interruption = yield* Effect.forkChild(Fiber.interrupt(task));

        yield* Effect.promise(() => aborted.promise);

        try {
          expect((yield* Effect.flip(voice.remove())).kind).toBe('invalid_input');
        } finally {
          cleanup.resolve();
        }

        yield* Fiber.join(interruption);
        yield* voice.remove();
        expect((yield* voice.status()).state).toBe('missing');
      })
    );
  }
);

test.server.stable(
  'interrupted model removal retains exclusivity until filesystem cleanup finishes',
  async ({ resources, expect, vi }) => {
    const entered = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    const interrupting = Promise.withResolvers<void>();
    const remove = VoiceModels.prototype.remove;

    vi.spyOn(VoiceModels.prototype, 'remove').mockImplementation(async function (
      this: VoiceModels
    ) {
      entered.resolve();
      await cleanup.promise;

      return remove.call(this);
    });
    const app = await resources.openApp({
      voice: { assets, fetch: async () => new Response(bytes) }
    });

    await app.nativeRuntime.runPromise(
      Effect.gen(function* () {
        const voice = yield* Voice;

        yield* voice.install();
        const task = yield* Effect.forkChild(voice.remove());

        yield* Effect.promise(() => entered.promise);
        const cancelled = yield* Effect.forkChild(
          Effect.sync(() => interrupting.resolve()).pipe(Effect.andThen(Fiber.interrupt(task)))
        );

        yield* Effect.promise(() => interrupting.promise);

        try {
          expect((yield* Effect.flip(voice.install())).kind).toBe('invalid_input');
        } finally {
          cleanup.resolve();
        }

        yield* Fiber.join(cancelled);
        yield* voice.install();
        expect((yield* voice.status()).state).toBe('ready');
      })
    );
  }
);
