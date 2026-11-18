/** @file Serves scripted ChatGPT catalog snapshots and complete Responses API results. */
import { ChatGptSession } from '@study/server';
import { Effect, Schema } from 'effect';

import { Settings } from '#server/features/settings/service/index';
import type { App } from '#server/runtime/service';

import { textResponseEvents } from './responses.ts';

interface Release {
  readonly model: string;
  readonly text: string;
}

const readModel = Schema.decodeUnknownSync(Schema.Struct({ model: Schema.String }));

export function createChatGptReleasePeer(releases: readonly Release[]) {
  const peer = {
    fetch: async (...args: Parameters<typeof fetch>) => {
      const request = new Request(...args);

      if (request.url === 'https://models.dev/api.json') return Response.json({});

      const authorization = request.headers.get('authorization');
      const index = releases.findIndex(({ model }) => authorization === `Bearer ${model}`);
      const selected = releases[index];

      if (!selected) return new Response(null, { status: 401 });

      if (request.url === 'https://api.openai.com/v1/models' && request.method === 'GET')
        return Response.json({
          models: releases
            .slice(0, index + 1)
            .map(({ model }) => ({ slug: model, visibility: 'list' }))
        });

      if (request.url !== 'https://api.openai.com/v1/responses' || request.method !== 'POST')
        throw new Error(`Unexpected provider request: ${request.method} ${request.url}`);

      const { model } = readModel(await request.json());

      const response = releases.find((release) => release.model === model);

      if (!response) throw new Error(`Unexpected model ${model}`);

      return new Response(
        textResponseEvents(response.text)
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } }
      );
    },
    select: (app: App, model: string) =>
      app.nativeRuntime.runPromise(
        Effect.gen(function* () {
          const session = yield* ChatGptSession;
          const { manager } = session;

          // Reconnecting the same fixture account invalidates its account-scoped catalog.
          yield* Effect.promise(() =>
            manager.replace(
              { subject: 'fixture', clientId: 'fixture', refreshToken: null, sharing: true },
              { accessToken: model, expiresIn: 3600 }
            )
          );
          const settings = yield* Settings;

          yield* settings.refreshModelRecommendations(session);
        })
      )
  };

  return peer;
}
