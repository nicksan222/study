/** @file Exercises ChatGPT model recommendations with the signed-in account catalog. */
import { test } from '@study/testing';
import { Clock, Effect } from 'effect';
import { TestClock } from 'effect/testing';

import { makeChatGptCatalog } from './catalog.ts';
import { AuthManager } from './session.ts';

test.unit.stable(
  'suggests current account models even when the preferred families disappear',
  async ({ expect }) => {
    const requests: string[] = [];
    const visible = (
      ...slugs: string[]
    ): { slug: string; visibility: string; display_name?: string }[] =>
      slugs.map((slug) => ({ slug, visibility: 'list' }));
    let failures = 0;
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

        if (failures) {
          failures--;

          return new Response(null, { status: 503 });
        }

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
            const inspect = yield* makeChatGptCatalog(auth, undefined, peer.url.origin);
            const catalog = (id: string) =>
              inspect.pipe(Effect.map((value) => value.recommend(id)));

            yield* signIn('first');
            expect(yield* catalog('gpt-6.1-sol')).toBe('gpt-6.10-sol');
            expect(yield* catalog('gpt-6-luna')).toBeUndefined();
            expect((yield* inspect).models).not.toContain('gpt-6.2-astra');
            expect(requests).toEqual(['Bearer first']);

            releases = visible('gpt-7-sol');
            expect(yield* catalog('gpt-6.1-sol')).toBe('gpt-6.10-sol');
            yield* TestClock.adjust('5 minutes');
            failures = 2;
            expect((yield* Effect.flip(catalog('gpt-6.1-sol'))).kind).toBe('transient');
            failures = 1;
            expect(yield* catalog('gpt-6.1-sol')).toBe('gpt-7-sol');
            expect(yield* catalog('gpt-6.1-sol')).toBe('gpt-7-sol');

            releases = visible('new-model', 'another-model');
            yield* signIn('second');
            expect(yield* catalog('gpt-6.1-sol')).toBe('new-model');
            expect(requests).toEqual([
              'Bearer first',
              'Bearer first',
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

            expect(yield* catalog('gpt-6.1-sol')).toBe('only-model');

            releases = [];
            yield* TestClock.adjust('5 minutes');
            expect(yield* catalog('gpt-6.1-sol')).toBeUndefined();

            yield* Effect.promise(() => auth.signOut());
            expect((yield* Effect.flip(catalog('gpt-6.1-sol'))).kind).toBe('auth');
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

test.unit.stable(
  'sign-out cancels an in-flight catalog and rejects a stopped token asynchronously',
  async ({ expect }) => {
    const auth = new AuthManager({
      issuer: 'https://login.example.test',
      saveRefresh: async () => {}
    });
    const started = Promise.withResolvers<AbortSignal>();
    const response = Promise.withResolvers<Response>();

    try {
      await auth.replace(
        { subject: 'old', clientId: 'study', refreshToken: null, sharing: true },
        { accessToken: 'old', expiresIn: 3600 }
      );
      const credentials = auth.credentials();
      const inspect = await Effect.runPromise(
        makeChatGptCatalog(auth, async (_input, options) => {
          started.resolve(options!.signal!);

          return response.promise;
        })
      );
      const failure = Effect.runPromise(Effect.flip(inspect));
      const signal = await started.promise;

      await auth.signOut();
      expect(signal.aborted).toBe(true);
      response.resolve(Response.json({ models: [{ slug: 'gpt-6.2-sol', visibility: 'list' }] }));
      expect((await failure).kind).toBe('auth');
      await expect(credentials.token()).rejects.toMatchObject({ kind: 'auth' });
    } finally {
      response.resolve(Response.json({ models: [] }));
      await auth.dispose();
    }
  }
);
