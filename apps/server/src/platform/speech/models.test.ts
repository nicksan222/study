import { BunFileSystem } from '@effect/platform-bun';
import { test } from '@study/testing';
import { CryptoHasher } from 'bun';
import { Effect, FileSystem, PlatformError } from 'effect';

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
    const root = location.path + '.voice';
    const controller = new AbortController();
    const partialWritten = Promise.withResolvers<void>();
    const chunk = payload.slice(0, 4);
    let firstDownload = true;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        start(stream) {
          controller.signal.addEventListener(
            'abort',
            () => stream.error(controller.signal.reason),
            { once: true }
          );
        },
        pull(stream) {
          if (pulls++ === 0) stream.enqueue(chunk);
          else partialWritten.resolve();
        }
      },
      { highWaterMark: 0 }
    );
    const models = new VoiceModels(
      root,
      fs,
      [asset],
      async () => new Response(firstDownload ? body : payload)
    );
    const installation = models.install(controller.signal);

    await partialWritten.promise;

    try {
      expect(await Bun.file(`${root}/installing/${asset.filename}`).bytes()).toEqual(chunk);
    } finally {
      controller.abort();
    }

    await expect(installation).rejects.toBeDefined();
    expect(await Effect.runPromise(fs.exists(`${root}/installing`))).toBe(false);
    expect((await models.status()).state).toBe('missing');
    firstDownload = false;
    await models.install(new AbortController().signal);
    expect((await models.status()).state).toBe('ready');
  }
);

test.server.stable(
  'voice initialization retries after stale directory cleanup fails',
  async ({ databases, expect }) => {
    const location = await databases();
    const root = location.path + '.voice';
    const failure = PlatformError.systemError({
      _tag: 'PermissionDenied',
      module: 'FileSystem',
      method: 'remove'
    });
    let failCleanup = true;
    const filesystem: FileSystem.FileSystem = {
      ...fs,
      remove: (path, options) =>
        path === `${root}/installing` && failCleanup
          ? Effect.fail(failure)
          : fs.remove(path, options)
    };
    const models = new VoiceModels(root, filesystem, [asset], async () => new Response(payload));

    await Effect.runPromise(fs.makeDirectory(`${root}/installing`, { recursive: true }));
    await Bun.write(`${root}/installing/stale.partial`, payload);
    await expect(models.status()).rejects.toMatchObject({ _tag: 'PlatformError' });
    failCleanup = false;
    expect((await models.status()).state).toBe('missing');
    expect(await Effect.runPromise(fs.exists(`${root}/installing`))).toBe(false);
    await models.install(new AbortController().signal);
    expect((await models.status()).state).toBe('ready');
    failCleanup = true;
    expect((await models.status()).state).toBe('ready');
  }
);

test.server.stable(
  'failed partial model removal invalidates readiness and permits repair',
  async ({ databases, expect }) => {
    const location = await databases();
    const root = location.path + '.voice';
    const failure = PlatformError.systemError({
      _tag: 'PermissionDenied',
      module: 'FileSystem',
      method: 'remove'
    });
    let failRemoval = false;
    const firstAssetRemoved = Promise.withResolvers<void>();
    const continueRemoval = Promise.withResolvers<void>();
    const pauseRemoval = Effect.promise(() => continueRemoval.promise);
    const filesystem: FileSystem.FileSystem = {
      ...fs,
      remove: (path, options) => {
        if (path !== `${root}/ready` || !failRemoval) return fs.remove(path, options);

        failRemoval = false;

        return Effect.gen(function* () {
          yield* fs.remove(`${path}/${asset.filename}`);
          firstAssetRemoved.resolve();
          yield* pauseRemoval;

          return yield* Effect.fail(failure);
        });
      }
    };
    const assets = [asset, { ...asset, filename: 'vad.gguf' }];
    const models = new VoiceModels(root, filesystem, assets, async () => new Response(payload));

    await models.install(new AbortController().signal);
    failRemoval = true;
    const removal = models.remove();

    await firstAssetRemoved.promise;

    try {
      expect(await Bun.file(models.path(0)).exists()).toBe(false);
      expect(await Bun.file(models.path(1)).exists()).toBe(true);
      expect((await models.status()).state).toBe('missing');
    } finally {
      continueRemoval.resolve();
    }

    await expect(removal).rejects.toMatchObject({ _tag: 'PlatformError' });
    expect((await models.status()).state).toBe('missing');
    await models.install(new AbortController().signal);
    expect((await models.status()).state).toBe('ready');
    expect(await Bun.file(models.path(0)).bytes()).toEqual(payload);
    expect(await Bun.file(models.path(1)).bytes()).toEqual(payload);
  }
);
