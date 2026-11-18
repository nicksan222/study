import { AgentRule } from '@study/contracts';
import {
  Agents,
  ChatGptSession,
  defineAgent,
  generateAgent,
  makeApiKeyCatalog,
  makeChatGptCatalog
} from '@study/server';
import { encodeAccount } from '@study/server';
import { Database } from '@study/server';
import { transaction } from '@study/server';
import { WorkflowConfiguration } from '@study/server';
import { test } from '@study/testing';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks durable configuration fingerprints change when same-account credentials are │
 * │ replaced without exposing secrets, survive application reopen, and follow current        │
 * │ language settings per operation.                                                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: same-account credential replacement changes the durable nonsecret             │
 * │   fingerprint; shared agent instructions resolve the current application language per    │
 * │   operation.                                                                             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/features/auth/index, #server/features/auth/store/index,                     │
 * │ #server/features/settings/index with real SQLite and application resources; fixture      │
 * │ cleanup closes owned resources.                                                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { Effect, Schema } from 'effect';

import { Auth } from '#server/features/auth/index';
import { AuthStore } from '#server/features/auth/store/index';
import { Settings } from '#server/features/settings/index';

test.server.stable(
  'same-account credential replacement changes the durable nonsecret fingerprint',
  async ({ resources: location, assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    let app = await location.openApp({ path: location.path });
    let savedRevision = '';

    try {
      await app.nativeRuntime.runPromise(
        Effect.gen(function* () {
          const configuration = yield* WorkflowConfiguration;
          const auth = yield* Auth;
          const account = encodeAccount({
            subject: 'same',
            clientId: 'client',
            refreshToken: 'private-token',
            sharing: true
          });

          yield* transaction((tx) => tx.store(AuthStore).saveAccount(account)).pipe(
            Effect.provideService(Database, { store: app.store })
          );
          const before = yield* configuration.revision;
          const publicAccount = yield* auth.publicAccount();

          yield* transaction((tx) => tx.store(AuthStore).saveAccount(account)).pipe(
            Effect.provideService(Database, { store: app.store })
          );
          savedRevision = yield* configuration.revision;

          assert.notStrictEqual(savedRevision, before);
          expect(yield* auth.publicAccount()).toStrictEqual(publicAccount);
          expect(savedRevision).toMatch(/^[a-f0-9]{64}$/);
          assert.ok(!savedRevision.includes('private-token'));
        })
      );
      await app.close();
      app = await location.openApp({ path: location.path });
      assert.strictEqual(
        await app.nativeRuntime.runPromise(
          Effect.flatMap(WorkflowConfiguration, (configuration) => configuration.revision)
        ),
        savedRevision
      );
    } finally {
      await app.close();
      await location.close();
    }
  }
);

test.server.stable(
  'shared agent instructions resolve the current application language per operation',
  async ({ resources: location, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const app = await location.openApp({ path: location.path });

    try {
      await app.nativeRuntime.runPromise(
        Effect.gen(function* () {
          const agents = yield* Agents;
          const settings = yield* Settings;
          const language = () =>
            typeof agents.language === 'string' ? Effect.succeed(agents.language) : agents.language;

          assert.strictEqual(yield* language(), 'english');
          const current = yield* settings.appSettings();

          yield* settings.saveAppSettings({ ...current, language: 2 });
          assert.strictEqual(yield* language(), 'italian');
        })
      );
    } finally {
      await app.close();
      await location.close();
    }
  }
);

const versionCheckAgent = defineAgent({
  id: 'model-version-check',
  input: Schema.String,
  output: Schema.String,
  model: 'medium',
  customRules: [AgentRule.Replies],
  instructions: 'Reply to the supplied message.',
  prompt: (message) => message
});

function textCompletion(model: string) {
  const base = { id: 'test', object: 'chat.completion.chunk', created: 1, model };
  const events = [
    {
      ...base,
      choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }]
    },
    {
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
  ];

  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
    {
      headers: { 'content-type': 'text/event-stream' }
    }
  );
}

test.server.stable(
  'an API-key provider uses its saved model until the user accepts its recommendation',
  async ({ resources, expect }) => {
    const before = 'deepseek-flash';
    const after = 'deepseek-newer-name';
    let expected = before;
    const fetchCatalog = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);

      if (request.url.endsWith('/chat/completions')) {
        expect(await request.json()).toMatchObject({ model: expected });

        return textCompletion(expected);
      }

      expect(request.url).toBe('https://models.dev/api.json');
      expect(request.headers.has('authorization')).toBe(false);

      return Response.json({
        deepseek: {
          models: Object.fromEntries(
            [before, after].map((id, index) => [
              id,
              {
                id,
                name: id,
                family: 'deepseek',
                release_date: index ? '2026-11-18' : '2026-11-17',
                tool_call: true,
                modalities: { output: ['text'] },
                cost: { output: 1 }
              }
            ])
          )
        }
      });
    };
    const app = await resources.openApp({ path: resources.path, fetch: fetchCatalog });

    try {
      await app.nativeRuntime.runPromise(
        Effect.gen(function* () {
          const auth = yield* Auth;
          const settings = yield* Settings;
          const { manager } = yield* ChatGptSession;
          const chat = yield* makeChatGptCatalog(manager, fetchCatalog);
          const api = yield* makeApiKeyCatalog(fetchCatalog);

          yield* auth.saveApiKey({ provider: 'deepseek', apiKey: 'test-secret' });
          yield* settings.saveLlmSettings({
            tiny: { provider: 1 },
            medium: { provider: 'deepseek', model: before },
            smart: { provider: 1 }
          });
          yield* settings.refreshModelRecommendations(auth.providers, chat, api);
          const [notice] = yield* settings.modelUpdates();

          expect(notice).toEqual({
            tier: 'medium',
            provider: 'deepseek',
            previousModel: before,
            model: after
          });
          expect(yield* generateAgent(versionCheckAgent, 'Hello')).toBe('Hello');
          yield* settings.updateModel(notice!, true);
          expected = after;
          expect(yield* generateAgent(versionCheckAgent, 'Hello')).toBe('Hello');
          expect(yield* settings.modelUpdates()).toEqual([]);
        })
      );
    } finally {
      await app.close();
      await resources.close();
    }
  }
);
