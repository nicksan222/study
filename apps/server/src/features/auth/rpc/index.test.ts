import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AuthRpc } from '@study/contracts/auth/rpc';
import { preferences } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Auth } from '#server/features/auth/index';
import { AuthManager } from '#server/platform/ai/auth/index';
import { ChatGptSession } from '#server/platform/ai/auth/service';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { AuthRpcLive } from './index.ts';

test('auth RPC exposes only public account and operations', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

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
  const handlers = AuthRpcLive.pipe(
    Layer.provide(Auth.layer),
    Layer.provide(
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

          assert.deepEqual(yield* client('auth.publicAccount', {}), {
            subject: 'person',
            email: undefined,
            sharing: true
          });
          assert.deepEqual(yield* client('auth.status', {}), {
            signedIn: true,
            email: null,
            sharing: true
          });
          assert.deepEqual(
            [...AuthRpc.requests.keys()].sort(),
            [
              'auth.status',
              'auth.publicAccount',
              'auth.startSignIn',
              'auth.finishSignIn',
              'auth.cancelSignIn',
              'auth.signOut'
            ].sort()
          );
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    await manager.dispose();
    context.close();
    location.cleanup();
  }
});
