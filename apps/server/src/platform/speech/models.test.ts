import { BunFileSystem } from '@effect/platform-bun';
import { test } from '@study/testing';
import { CryptoHasher } from 'bun';
import { Effect, FileSystem } from 'effect';

import { VoiceModels } from './models.ts';

const fs = await Effect.runPromise(FileSystem.FileSystem.pipe(Effect.provide(BunFileSystem.layer)));

const payload = new TextEncoder().encode('verified model');

const asset = {
  filename: 'test.gguf',
  url: 'https://example.test/model',
  size: payload.length,
  sha256: new CryptoHasher('sha256').update(payload).digest('hex')
};

test.server.stable(
  'voice models only become ready after verified install and remain installed on reopen',
  async ({ databases, expect }) => {
    const location = await databases();
    const root = location.path + '.voice';
    const models = new VoiceModels(root, fs, [asset], async () => new Response(payload));

    expect(await models.status()).toEqual({
      state: 'missing',
      downloadedBytes: 0,
      totalBytes: payload.length
    });
    await models.install(new AbortController().signal);
    expect((await models.status()).state).toBe('ready');
    expect((await new VoiceModels(root, fs, [asset]).status()).state).toBe('ready');
    await Bun.write(models.path(0), new Uint8Array(payload.length));
    expect((await new VoiceModels(root, fs, [asset]).status()).state).toBe('missing');
    await models.remove();
    expect((await models.status()).state).toBe('missing');
  }
);

test.server.stable(
  'voice model integrity failures never publish a ready model and can retry',
  async ({ databases, expect }) => {
    const location = await databases();
    let corrupt = true;
    const models = new VoiceModels(
      location.path + '.voice',
      fs,
      [asset],
      async () => new Response(corrupt ? new Uint8Array(payload.length) : payload)
    );

    await expect(models.install(new AbortController().signal)).rejects.toMatchObject({
      kind: 'invalid_input'
    });
    expect((await models.status()).state).toBe('missing');
    corrupt = false;
    await models.install(new AbortController().signal);
    expect((await models.status()).state).toBe('ready');
  }
);

test.server.stable(
  'cancelling a model download removes partial data and permits another install',
  async ({ databases, expect }) => {
    const location = await databases();
    const controller = new AbortController();
    const models = new VoiceModels(location.path + '.voice', fs, [asset], async (_url, options) => {
      controller.abort();
      options?.signal?.throwIfAborted();

      return new Response(payload);
    });

    await expect(models.install(controller.signal)).rejects.toBeDefined();
    expect((await models.status()).state).toBe('missing');
  }
);
