/** @file Serves scripted ChatGPT catalog snapshots and complete Responses API results. */
import { ChatGptSession } from '@study/server';
import { Effect, Schema } from 'effect';

import type { App } from '#server/runtime/service';

import { textResponseEvents } from './responses.ts';

interface Release {
  readonly model: string;
  readonly text: string;
}

const readModel = Schema.decodeUnknownSync(Schema.Struct({ model: Schema.String }));

export function createChatGptReleasePeer(releases: readonly Release[]) {
  return {
    fetch: async (...args: Parameters<typeof fetch>) => {
      const request = new Request(...args);
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

      if (model !== selected.model)
        throw new Error(`Expected ${selected.model}, received ${model}`);

      return new Response(
        textResponseEvents(selected.text)
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } }
      );
    },
    select: (app: App, model: string) =>
      app.nativeRuntime.runPromise(
        Effect.flatMap(ChatGptSession, ({ manager }) =>
          // Reconnecting the same fixture account invalidates its account-scoped catalog.
          Effect.promise(() =>
            manager.replace(
              { subject: 'fixture', clientId: 'fixture', refreshToken: null, sharing: true },
              { accessToken: model, expiresIn: 3600 }
            )
          )
        )
      )
  };
}
