/** @file Resolves stable model families against the catalog of the signed-in ChatGPT account. */
import { StudyError } from '@study/contracts';
import { Cache, Effect, Exit, Schema } from 'effect';

import { allowsAiModel } from '#server/platform/ai/providers/model-policy';
import { normalizeError } from '#server/platform/errors/classify-error';
import type { FetchOptions } from '#server/platform/http/index';
import { streamingFetch } from '#server/platform/http/index';

import { chatGptApiUrl } from './model.ts';
import type { AuthManager, ChatGptCredentials } from './session.ts';

const catalogSchema = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      slug: Schema.String.check(Schema.isPattern(/^\S+$/), Schema.isMaxLength(200)),
      visibility: Schema.String,
      display_name: Schema.optional(Schema.String)
    })
  )
});

// Base releases only. Preview, specialized and dated variants can have different capabilities.
const releaseSlug = /^gpt-(\d+)(?:\.(\d+))?-([a-z]+)$/;

function parseRelease(model: string) {
  const match = releaseSlug.exec(model);

  if (!match?.[3]) return undefined;

  return {
    family: match[3],
    model,
    generation: Number(match[1]),
    revision: Number(match[2] ?? 0)
  };
}

const compare = (
  a: NonNullable<ReturnType<typeof parseRelease>>,
  b: NonNullable<ReturnType<typeof parseRelease>>
) => a.generation - b.generation || a.revision - b.revision;

function requestCatalog(auth: ChatGptCredentials, request: FetchOptions['fetch'], baseUrl: string) {
  return Effect.tryPromise({
    try: async (signal) => {
      for (let attempt = 0; ; attempt++) {
        const token = await auth.token();
        const response = await streamingFetch(
          `${baseUrl}/models`,
          { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal },
          { fetch: request, clock: auth.clock, timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024 }
        );

        if (response.ok) return response.json() as Promise<unknown>;

        await response.body?.cancel();

        if (response.status === 401 && attempt === 0) {
          auth.refused(token);
          continue;
        }

        if (response.status === 401 || response.status === 403)
          throw new StudyError('auth', 'ChatGPT model catalog access denied');

        if (response.status === 429)
          throw new StudyError('rate_limited', 'ChatGPT model catalog rate limited');

        throw new StudyError('transient', 'ChatGPT model catalog unavailable');
      }
    },
    catch: (cause) =>
      cause instanceof StudyError
        ? cause
        : new StudyError('transient', 'ChatGPT model catalog request failed')
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(catalogSchema)),
    Effect.mapError((cause) =>
      cause instanceof StudyError
        ? cause
        : new StudyError('transient', 'Invalid ChatGPT model catalog')
    ),
    Effect.map(({ models }) =>
      models
        .filter(
          ({ slug, visibility, display_name }) =>
            visibility === 'list' && allowsAiModel(slug, display_name)
        )
        .map(({ slug }) => slug)
    )
  );
}

export const makeChatGptCatalog = (
  manager: AuthManager,
  request?: FetchOptions['fetch'],
  baseUrl = chatGptApiUrl
) =>
  Effect.gen(function* () {
    const currentSession = Effect.try({
      try: () => manager.credentials(),
      catch: normalizeError
    });
    const cache = yield* Cache.makeWith(
      (id: symbol) =>
        currentSession.pipe(
          Effect.flatMap((auth) =>
            auth.id === id
              ? requestCatalog(auth, request, baseUrl)
              : Effect.fail(new StudyError('auth', 'ChatGPT session changed'))
          )
        ),
      { capacity: 1, timeToLive: (exit) => (Exit.isSuccess(exit) ? '5 minutes' : 0) }
    );

    return currentSession.pipe(
      Effect.flatMap((auth) => Cache.get(cache, auth.id)),
      Effect.map((models) => ({
        models,
        recommend: (id: string | undefined) => {
          const current = id === undefined ? undefined : parseRelease(id);
          const newer = models.flatMap((model) => {
            const candidate = parseRelease(model);

            return current &&
              candidate &&
              candidate.family === current.family &&
              compare(candidate, current) > 0
              ? [candidate]
              : [];
          });

          return (
            newer.toSorted((a, b) => compare(b, a))[0]?.model ??
            (id !== undefined && models.includes(id) ? undefined : models[0])
          );
        }
      }))
    );
  });
