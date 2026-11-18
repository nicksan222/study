import { BunPath } from '@effect/platform-bun';
import { StudyError, StudyRpc } from '@study/contracts';
import { makeStudyClient } from '@study/server/client';
import type { speechRecognitionStrategies } from '@study/server/testing';
import type { test } from '@study/testing';
import { Effect, Exit, Path, Scope } from 'effect';

import { localModelPaths } from './local-model-file.ts';

const path = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

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
  const modelsDirectory = requiredModelDirectory();
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

/** Replaces only asset delivery. Native inference, settings, installation and HTTP RPC stay real. */
export async function openVoiceModel(
  resources: test.server.Context['resources'],
  strategy: Strategy
) {
  const connection = await openVoiceClient(resources, strategy);
  const scope = Scope.makeUnsafe();

  resources.dispose(() => Effect.runPromise(Scope.close(scope, Exit.void)));

  const client = await Effect.runPromise(Scope.provide(connection, scope));
  const initial = await Effect.runPromise(client['voice.status']({}));

  await Effect.runPromise(client['voice.install']({}));
  resources.dispose(async () => {
    await Effect.runPromise(client['voice.remove']({}));

    if ((await Effect.runPromise(client['voice.status']({}))).state !== 'missing')
      throw new Error(`Speech model ${strategy.model.id} remained installed after removal`);
  });

  return { client, initial, installed: await Effect.runPromise(client['voice.status']({})) };
}

export type VoiceModelFixture = Awaited<ReturnType<typeof openVoiceModel>>;

export function pcm16(pcm: Float32Array) {
  return Array.from(pcm, (sample) => Math.max(-32768, Math.min(32767, Math.round(sample * 32768))));
}

export function normalize(text: string) {
  return (
    text
      .toLocaleLowerCase('en')
      .normalize('NFC')
      .replaceAll('’', "'")
      .replace(/[^\p{L}\p{N}'\s]/gu, '')
      .match(/\S+/g) ?? []
  );
}
