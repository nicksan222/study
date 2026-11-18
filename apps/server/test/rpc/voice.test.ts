import { MAX_DICTATION_SAMPLES, StudyRpc, dictationInputSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Effect, Fiber, Schema } from 'effect';

import { makeStudyClient } from '#server/client/index';

test.server.stable(
  'a complete 30-second dictation segment fits native HTTP RPC without losing PCM16 samples',
  async ({ resources, expect, voice }) => {
    const expected = voice.next({ text: 'Complete dictation' });
    const { server } = await resources.openRpc({ voice: voice.runtime });
    const samples = Array.from({ length: MAX_DICTATION_SAMPLES }, (_, index) =>
      index % 2 ? -32768 : 32767
    );

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

          yield* client['voice.install']({});
          expect(yield* client['voice.status']({})).toMatchObject({
            modelId: 'parakeet-tdt-v3',
            models: expect.arrayContaining([
              {
                id: 'parakeet-tdt-v3',
                name: 'Parakeet TDT 0.6B v3',
                languages: expect.arrayContaining(['it', 'en', 'fr']),
                languageDetection: 'automatic'
              }
            ])
          });
          expect(yield* client['voice.transcribe']({ samples })).toEqual({
            text: 'Complete dictation'
          });
        })
      )
    );
    const received = await expected.called;

    expect(received.samples).toEqual(samples);
  }
);

test.server.stable(
  'a delayed cancellation cannot abort a replacement model download',
  async ({ resources, expect, voice }) => {
    const first = voice.holdDownload();
    const { server } = await resources.openRpc({ voice: voice.runtime });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
          const original = yield* Effect.forkScoped(Effect.flip(client['voice.install']({})));

          yield* Effect.promise(() => first.called);
          const originalStatus = yield* client['voice.status']({});
          const originalId = originalStatus.installationId;

          expect(originalStatus.state).toBe('downloading');

          if (!originalId) throw new Error('Expected a download identity');

          yield* client['voice.cancelInstall']({ installationId: originalId });
          expect(yield* Fiber.join(original)).toMatchObject({ kind: 'cancelled' });

          const second = voice.holdDownload();
          const replacement = yield* Effect.forkScoped(Effect.flip(client['voice.install']({})));

          yield* Effect.promise(() => second.called);
          const replacementId = (yield* client['voice.status']({})).installationId;

          if (!replacementId) throw new Error('Expected a replacement download identity');

          expect(replacementId).not.toBe(originalId);
          yield* client['voice.cancelInstall']({ installationId: originalId });
          expect(yield* client['voice.status']({})).toMatchObject({
            state: 'downloading',
            installationId: replacementId
          });
          yield* client['voice.cancelInstall']({ installationId: replacementId });
          expect(yield* Fiber.join(replacement)).toMatchObject({ kind: 'cancelled' });
          const status = yield* client['voice.status']({});

          expect(status.state).toBe('missing');
          expect(status).not.toHaveProperty('installationId');
        })
      )
    );
  }
);

test.unit.stable(
  'dictation rejects audio beyond its bound and values outside PCM16',
  async ({ expect }) => {
    const accepts = Schema.is(dictationInputSchema);

    expect(accepts({ samples: Array(MAX_DICTATION_SAMPLES + 1).fill(0) })).toBe(false);

    for (const sample of [32768, -32769, 0.5, NaN, Infinity])
      expect(accepts({ samples: [sample] })).toBe(false);

    expect(accepts({ samples: [] })).toBe(false);
  }
);
