import { AuthRpc } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies the auth RPC exposes only safe account fields and the six supported sign- │
 * │ in, status, and sign-out operations.                                                     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Uses an RPC test client and SQLite state to inspect the exposed contract.              │
 * │ - Checks the contract through typed RPC calls and controlled feature layers.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite uses the typed RPC test client and controlled feature layers; production       │
 * │ handlers retain ownership of request behavior.                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { preferences } from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Auth } from '#server/features/auth/index';
import { AuthManager } from '#server/platform/ai/auth/index';
import { ChatGptSession } from '#server/platform/ai/auth/service';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { testLiveQueries } from '#testing/live-queries';

import { AuthRpcLive } from './index.ts';

test.stable('auth RPC exposes only public account and operations', async ({ databases }) => {
  const location = await databases();
  const context = new ServerContext(await location.open());

  context.db.orm
    .insert(preferences)
    .values({
      scope: 'private.chatgpt',
      key: 'account',
      value: JSON.stringify({
        subject: 'person',
        clientId: 'private-client',
        refreshToken: 'private-token',
        sharing: true
      })
    })
    .run();
  const manager = new AuthManager({ issuer: 'http://localhost', saveRefresh: async () => {} });
  const handlers = AuthRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
    Layer.provide(Auth.layer),
    Layer.provideMerge(
      Layer.merge(
        Layer.succeed(Database, { store: context }),
        Layer.succeed(ChatGptSession, { manager, issuer: 'http://localhost', hostId: 'test' })
      )
    )
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(AuthRpc, { flatten: true });

          test.expect(yield* client('auth.publicAccount', {})).toStrictEqual({
            subject: 'person',
            email: undefined,
            sharing: true
          });
          test.expect(yield* client('auth.status', {})).toStrictEqual({
            signedIn: true,
            email: null,
            sharing: true
          });
          yield* client('auth.saveApiKey', { provider: 'anthropic', apiKey: 'rpc-secret' });
          const providers = yield* client('auth.providers', {});

          test
            .expect(providers.find((provider) => provider.id === 'anthropic')?.configured)
            .toBe(true);
          test.expect(JSON.stringify(providers)).not.toContain('rpc-secret');
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    await manager.dispose();
    context.close();
    await location.cleanup();
  }
});
