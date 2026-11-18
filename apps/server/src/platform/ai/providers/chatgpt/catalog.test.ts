/** @file Exercises automatic ChatGPT model selection with the signed-in account catalog. */
import { LlmModel } from '@study/contracts';
import { test } from '@study/testing';
import { Clock, Effect } from 'effect';
import { TestClock } from 'effect/testing';

import { makeChatGptCatalog } from './catalog.ts';
import { AuthManager } from './session.ts';

test.unit.stable(
  'selects current account models even when the preferred families disappear',
  async ({ expect }) => {
    const requests: string[] = [];
    const visible = (
      ...slugs: string[]
    ): { slug: string; visibility: string; display_name?: string }[] =>
      slugs.map((slug) => ({ slug, visibility: 'list' }));
    let unavailable = false;
    let releases = visible(
      'gpt-6.2-sol',
      'gpt-6.10-sol',
      'gpt-6-luna',
      'gpt-6.2-astra',
      'gpt-10-sol-preview',
      'gpt-8-sol-2026-11-18'
    );
    const peer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request) => {
        const authorization = request.headers.get('authorization') ?? '';

        requests.push(authorization);

        if (unavailable) return new Response(null, { status: 503 });

        return Response.json({
          models: [{ slug: 'gpt-9-sol', visibility: 'hide' }, ...releases]
        });
      }
    });

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const auth = new AuthManager({
            issuer: peer.url.origin,
            saveRefresh: async () => {},
            clock: yield* Clock.Clock
          });
          const signIn = (subject: string) =>
            Effect.promise(() =>
              auth.replace(
                { subject, clientId: 'study', refreshToken: subject, sharing: true },
                { accessToken: subject, expiresIn: 3600 }
              )
            );

          try {
            const resolve = yield* makeChatGptCatalog(auth, undefined, peer.url.origin);
            const catalog = (family: LlmModel) =>
              resolve(family).pipe(Effect.map((selection) => selection.modelId));

            yield* signIn('first');
            expect(
              yield* Effect.all(
                [catalog(LlmModel.SOL), catalog(LlmModel.LUNA), catalog(LlmModel.ASTRA)],
                { concurrency: 'unbounded' }
              )
            ).toEqual(['gpt-6.10-sol', 'gpt-6-luna', 'gpt-6.10-sol']);
            expect(requests).toEqual(['Bearer first']);

            releases = visible('gpt-7-sol');
            expect(yield* catalog(LlmModel.SOL)).toBe('gpt-6.10-sol');
            yield* TestClock.adjust('5 minutes');
            unavailable = true;
            expect((yield* Effect.flip(catalog(LlmModel.SOL))).kind).toBe('transient');
            unavailable = false;
            expect(yield* catalog(LlmModel.SOL)).toBe('gpt-7-sol');
            expect(yield* catalog(LlmModel.ASTRA)).toBe('gpt-7-sol');

            releases = visible('new-model', 'another-model');
            yield* signIn('second');
            expect(yield* catalog(LlmModel.SOL)).toBe('new-model');
            expect(requests).toEqual([
              'Bearer first',
              'Bearer first',
              'Bearer first',
              'Bearer second'
            ]);

            releases = [
              { slug: 'opaque-model', visibility: 'list', display_name: 'GPT 7 Astra' },
              ...visible('only-model')
            ];
            yield* TestClock.adjust('5 minutes');

            for (const family of Object.values(LlmModel))
              expect(yield* catalog(family)).toBe('only-model');

            releases = [];
            yield* TestClock.adjust('5 minutes');
            expect((yield* Effect.flip(catalog(LlmModel.SOL))).kind).toBe('unsupported');

            yield* Effect.promise(() => auth.signOut());
            expect((yield* Effect.flip(catalog(LlmModel.SOL))).kind).toBe('auth');
          } finally {
            yield* Effect.promise(() => auth.dispose());
          }
        }).pipe(Effect.provide(TestClock.layer()))
      );
    } finally {
      peer.stop(true);
    }
  }
);
