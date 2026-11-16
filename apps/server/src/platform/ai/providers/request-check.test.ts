import { StudyError } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks ownership preflight for both API key model generation and streaming         │
 * │ requests.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies rejected ownership checks prevent credential bearing transport requests.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The native Effect adapter is wrapped before either model call reaches its transport.          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Cause, Effect, Exit, Stream } from 'effect';
import { LanguageModel } from 'effect/ai';

import { AiRequestCheck } from '#server/platform/ai/model';

import { createApiKeyModel } from './api-key-model.ts';
import { getApiKeyProvider } from './registry.ts';

test.unit.stable(
  'preflight blocks API-key model requests before the transport sees credentials',
  async ({ expect }) => {
    let requests = 0;
    const model = getApiKeyProvider('deepseek').createModel({
      apiKey: 'test-secret',
      modelId: 'deepseek-chat',
      fetch: async () => {
        requests++;

        throw new Error('unexpected transport');
      }
    });
    const lost = new StudyError('cancelled', 'ownership lost');
    const check = Effect.fail(lost);
    const generate = LanguageModel.generateText({ prompt: 'Hello' }).pipe(
      Effect.provide(model),
      Effect.provideService(AiRequestCheck, check)
    );
    const stream = LanguageModel.streamText({ prompt: 'Hello' }).pipe(
      Stream.runCollect,
      Effect.provide(model),
      Effect.provideService(AiRequestCheck, check)
    );

    for (const operation of [generate.pipe(Effect.asVoid), stream.pipe(Effect.asVoid)]) {
      const result = await Effect.runPromiseExit(operation);

      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result)) expect(Cause.squash(result.cause)).toBe(lost);
    }

    expect(requests).toBe(0);
  }
);

test.unit.stable(
  'ownership is checked again after waiting for fresh credentials',
  async ({ expect }) => {
    const waiting = Promise.withResolvers<void>();
    const credential = Promise.withResolvers<string>();
    const lost = new StudyError('cancelled', 'ownership lost while waiting');
    let owns = true;
    let requests = 0;
    const model = createApiKeyModel(
      getApiKeyProvider('deepseek'),
      'test',
      Effect.tryPromise({
        try: () => {
          waiting.resolve();

          return credential.promise;
        },
        catch: () => new StudyError('auth', 'Credential wait failed')
      }),
      async () => {
        requests++;

        throw new Error('unexpected request');
      }
    );
    const pending = Effect.runPromiseExit(
      LanguageModel.generateText({ prompt: 'Hello' }).pipe(
        Effect.provide(model),
        Effect.provideService(
          AiRequestCheck,
          Effect.suspend(() => (owns ? Effect.void : Effect.fail(lost)))
        )
      )
    );

    await waiting.promise;
    owns = false;
    credential.resolve('secret-current-key');
    const result = await pending;

    expect(Exit.isFailure(result)).toBe(true);

    if (Exit.isFailure(result)) expect(Cause.squash(result.cause)).toBe(lost);

    expect(requests).toBe(0);
  }
);

test.unit.stable(
  'interrupting a native credential read prevents provider transport',
  async ({ expect }) => {
    const waiting = Promise.withResolvers<void>();
    const interrupted = Promise.withResolvers<void>();
    const controller = new AbortController();
    let requests = 0;
    const read = Effect.sync(() => waiting.resolve()).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() => Effect.sync(() => interrupted.resolve()))
    );
    const model = createApiKeyModel(getApiKeyProvider('deepseek'), 'test', read, async () => {
      requests++;

      throw new Error('unexpected request');
    });
    const pending = Effect.runPromiseExit(
      LanguageModel.generateText({ prompt: 'Hello' }).pipe(Effect.provide(model)),
      { signal: controller.signal }
    );

    await waiting.promise;
    controller.abort();
    await interrupted.promise;
    const result = await pending;

    expect(Exit.isFailure(result)).toBe(true);

    if (Exit.isFailure(result)) expect(Cause.hasInterruptsOnly(result.cause)).toBe(true);

    expect(requests).toBe(0);
  }
);
