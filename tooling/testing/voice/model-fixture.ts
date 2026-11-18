import { BunPath } from '@effect/platform-bun';
import { StudyError, StudyRpc } from '@study/contracts';
import { makeStudyClient } from '@study/server/client';
import { speechRecognitionStrategies } from '@study/server/testing';
import type { test } from '@study/testing';
import { Effect, Path } from 'effect';

import { localModelPaths } from './local-model-file.ts';

const path = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

const modelsDirectory = requiredModelDirectory();

function requiredModelDirectory() {
  const directory = process.env.STUDY_VOICE_MODELS_DIR;

  if (!directory)
    throw new Error(
      'Set STUDY_VOICE_MODELS_DIR to a directory containing the pinned voice assets.'
    );

  return directory;
}

type Strategy = (typeof speechRecognitionStrategies)[number];

async function openVoiceClient(resources: test.server.Context['resources'], strategy: Strategy) {
  const { model, assets } = strategy;
  const { server } = await resources.openRpc({
    voice: {
      modelId: model.id,
      fetch: async (url) => {
        const candidates = localModelPaths({ id: model.id, assets }, url, modelsDirectory, path);

        if (!candidates)
          throw new StudyError('invalid_input', `Unexpected voice asset request for ${model.id}`);

        for (const candidate of candidates) {
          const file = Bun.file(candidate);

          if (await file.exists()) return new Response(file);
        }

        throw new StudyError(
          'model_unavailable',
          `Missing pinned asset for ${model.id}. Tried ${candidates.join(', ')}`
        );
      }
    }
  });

  return makeStudyClient(StudyRpc, { baseUrl: server.url });
}

type VoiceClient = Effect.Success<Awaited<ReturnType<typeof openVoiceClient>>>;

/** Replaces only asset delivery. Native inference, settings, installation and HTTP RPC stay real. */
export async function withVoiceModel(
  { resources, expect }: Pick<test.server.Context, 'resources' | 'expect'>,
  strategy: Strategy,
  exercise: (client: VoiceClient) => Effect.Effect<void, unknown>
) {
  const connection = await openVoiceClient(resources, strategy);

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* connection;

        const status = yield* client['voice.status']({});

        expect(status).toMatchObject({
          modelId: strategy.model.id,
          state: 'missing'
        });
        expect(status.models).toEqual(speechRecognitionStrategies.map(({ model }) => model));
        yield* client['voice.install']({});
        expect((yield* client['voice.status']({})).state).toBe('ready');
        yield* exercise(client);
        yield* client['voice.remove']({});
        expect((yield* client['voice.status']({})).state).toBe('missing');
      })
    )
  );
}

export function pcm16(pcm: Float32Array) {
  return Array.from(pcm, (sample) => Math.max(-32768, Math.min(32767, Math.round(sample * 32768))));
}

export function normalize(text: string) {
  return (
    text
      .toLocaleLowerCase('en')
      .replace(/[^\p{L}\p{N}'\s]/gu, '')
      .match(/\S+/g) ?? []
  );
}
